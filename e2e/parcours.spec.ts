/**
 * Tests de bout en bout sur des adresses réelles, avec les vrais services de
 * l'IGN (réseau requis). Trois villes : Paris, petite couronne, Lyon ; plus
 * Lille pour le repli sans LiDAR HD.
 */
import { expect, test, type Page } from '@playwright/test';

interface Api {
  scene(): { mode: string; avertissements: string[] } | null;
  resultat(): {
    dureeMs: number;
    fenetres: Array<{
      detail: { indicateurs: { heuresAn: number; heuresRefAn: number; cielVisible: number; energieAn: number; moyenneHiver: number; moyenneEte: number } } | null;
      etages: Array<{ valide: boolean; indicateurs: { heuresAn: number } | null }>;
      chrono: { horizon: number; simulation: number };
    }>;
  } | null;
  etat(): { fenetres: Array<{ etage: number }>; actif: number };
  murs(): Array<{ distance: number; ecran: { x: number; y: number } }>;
}
declare global {
  interface Window {
    pleinSoleil: Api;
  }
}

const ADRESSES = [
  { ville: 'Paris', saisie: '45 rue de la Roquette 75011 Paris', attendu: /Roquette/i },
  { ville: 'Montreuil (petite couronne)', saisie: '20 rue du Capitaine Dreyfus Montreuil', attendu: /Dreyfus/i },
  { ville: 'Lyon', saisie: '8 rue des Capucins 69001 Lyon', attendu: /Capucins/i },
];

function surveiller(page: Page): string[] {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push(m.text());
  });
  return erreurs;
}

/** Recherche une adresse et attend la scène ; renvoie la durée entre le choix de l'adresse et la scène prête. */
async function chercher(page: Page, saisie: string, attendu: RegExp): Promise<number> {
  await page.goto('./');
  await page.getByLabel('Adresse du logement').fill(saisie);
  const premiere = page.locator('#suggestions li[role="option"]').first();
  await expect(premiere).toBeVisible({ timeout: 20_000 });
  await expect(premiere).toContainText(attendu);
  const t0 = Date.now();
  await premiere.dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.pleinSoleil.scene() !== null, undefined, { timeout: 60_000 });
  return Date.now() - t0;
}

/** Clique sur le mur libre le plus proche de l'adresse qui soit visible sur la carte. */
async function cliquerMur(page: Page): Promise<void> {
  const boite = (await page.locator('#carte').boundingBox())!;
  const mur = await page.evaluate(
    ({ l, h }) => window.pleinSoleil.murs().find((m) => m.ecran.x > 30 && m.ecran.y > 60 && m.ecran.x < l - 30 && m.ecran.y < h - 30) ?? null,
    { l: boite.width, h: boite.height },
  );
  expect(mur, 'au moins un mur libre visible près de l’adresse').not.toBeNull();
  await page.mouse.click(boite.x + mur!.ecran.x, boite.y + mur!.ecran.y);
  await page.waitForFunction(() => window.pleinSoleil.resultat() !== null, undefined, { timeout: 30_000 });
  await expect(page.locator('#resultats')).toBeVisible();
}

for (const a of ADRESSES) {
  test(`parcours complet — ${a.ville}`, async ({ page }) => {
    const erreurs = surveiller(page);
    const tScene = await chercher(page, a.saisie, a.attendu);
    expect(await page.evaluate(() => window.pleinSoleil.scene()!.mode)).toBe('lidar');

    const t1 = Date.now();
    await cliquerMur(page);
    const tCalcul = Date.now() - t1;
    const r = await page.evaluate(() => {
      const res = window.pleinSoleil.resultat()!;
      const f = res.fenetres[0];
      return { indicateurs: f.detail?.indicateurs ?? null, etages: f.etages.map((e) => (e.valide ? e.indicateurs!.heuresAn : null)), chrono: f.chrono };
    });
    console.log(`${a.ville} : scène ${tScene} ms, premier résultat ${tCalcul} ms après le clic, calcul ${Math.round(r.chrono.horizon + r.chrono.simulation)} ms`);
    console.log(`  ${Math.round(r.indicateurs!.heuresAn)} h/an, référence ${Math.round(r.indicateurs!.heuresRefAn)} h, ciel ${(r.indicateurs!.cielVisible * 100).toFixed(0)} %, étages : ${r.etages.map((h) => (h === null ? '—' : Math.round(h))).join(' / ')}`);

    // Cohérence physique des résultats.
    expect(r.indicateurs).not.toBeNull();
    const i = r.indicateurs!;
    expect(i.heuresRefAn).toBeGreaterThan(400);
    expect(i.heuresRefAn).toBeLessThan(3800);
    expect(i.heuresAn).toBeGreaterThanOrEqual(0);
    expect(i.heuresAn).toBeLessThanOrEqual(i.heuresRefAn + 1);
    expect(i.cielVisible).toBeGreaterThan(0);
    expect(i.cielVisible).toBeLessThanOrEqual(1);
    const valides = r.etages.filter((h): h is number => h !== null);
    expect(valides.length).toBeGreaterThanOrEqual(3);
    // Le dernier étage reçoit au moins autant de soleil que le premier.
    expect(valides[valides.length - 1]).toBeGreaterThanOrEqual(valides[0]);
    // Premier résultat en moins de 8 s (chargement de la scène + calcul).
    expect(tScene + tCalcul).toBeLessThan(process.env.CI ? 20_000 : 8_000);

    // Les graphiques sont dessinés et l'indicateur principal affiché.
    await expect(page.locator('.indicateur--phare .indicateur__valeur')).toContainText(/\d/);
    for (const id of ['g-annee', 'g-calendrier', 'g-journee', 'g-etages', 'g-course']) {
      const canvas = page.locator(`#${id} canvas`);
      await expect(canvas).toBeVisible();
      expect((await canvas.boundingBox())!.height).toBeGreaterThan(60);
    }

    // Changement d'étage : recalcul rapide et résultat différent.
    const avant = await page.evaluate(() => window.pleinSoleil.etat().fenetres[0].etage);
    const bouton = (await page.locator('#etage-plus').isEnabled()) ? '#etage-plus' : '#etage-moins';
    await page.locator(bouton).click();
    await page.waitForFunction((e) => window.pleinSoleil.etat().fenetres[0].etage !== e && window.pleinSoleil.resultat()!.fenetres[0].etages.length > 0, avant);
    await page.waitForTimeout(400);
    const recalcul = await page.evaluate(() => window.pleinSoleil.resultat()!.dureeMs);
    console.log(`  recalcul d'un étage : ${recalcul.toFixed(0)} ms`);
    expect(recalcul).toBeLessThan(process.env.CI ? 400 : 100);

    expect(erreurs, erreurs.join('\n')).toEqual([]);
  });
}

test('partage par lien, comparateur, exports et vue 3D', async ({ page, context }) => {
  const erreurs = surveiller(page);
  const a = ADRESSES[0];
  await chercher(page, a.saisie, a.attendu);
  await cliquerMur(page);
  const heures = await page.evaluate(() => window.pleinSoleil.resultat()!.fenetres[0].detail!.indicateurs.heuresAn);

  // Le lien rouvre exactement le même calcul.
  const url = page.url();
  expect(url).toContain('#l=');
  const autre = await context.newPage();
  await autre.goto(url);
  await autre.waitForFunction(() => window.pleinSoleil.resultat() !== null, undefined, { timeout: 60_000 });
  const heures2 = await autre.evaluate(() => window.pleinSoleil.resultat()!.fenetres[0].detail!.indicateurs.heuresAn);
  expect(Math.abs(heures2 - heures)).toBeLessThan(0.5);
  await expect(autre.locator('#recherche')).toHaveValue(a.attendu);
  await autre.close();

  // Comparateur : enregistré, conservé après rechargement.
  await page.locator('#b-enregistrer').click();
  await expect(page.locator('#comparateur .logement')).toHaveCount(1);
  await expect(page.locator('#comparateur-nombre')).toHaveText('1');
  await page.reload();
  await expect(page.locator('#comparateur-nombre')).toHaveText('1');
  await page.waitForFunction(() => window.pleinSoleil.resultat() !== null, undefined, { timeout: 60_000 });

  // Exports.
  const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('#b-csv').click()]);
  expect(csv.suggestedFilename()).toMatch(/^plein-soleil-.*\.csv$/);
  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.locator('#b-pdf').click()]);
  expect(pdf.suggestedFilename()).toMatch(/^plein-soleil-.*\.pdf$/);

  // Vue 3D : le maillage se construit et s'affiche sans message d'erreur.
  await page.locator('#onglet-3d').click();
  await expect(page.locator('#vue3d-canvas')).toBeVisible();
  await expect(page.locator('#vue3d-message')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#v3-date-texte')).not.toBeEmpty();

  expect(erreurs, erreurs.join('\n')).toEqual([]);
});

test('zone sans LiDAR HD : repli annoncé clairement (Lille)', async ({ page }) => {
  const erreurs = surveiller(page);
  await chercher(page, '10 rue de Béthune Lille', /Béthune/i);
  expect(await page.evaluate(() => window.pleinSoleil.scene()!.mode)).toBe('bdtopo');
  await expect(page.locator('#avertissements .avis').first()).toContainText('LiDAR HD');
  await cliquerMur(page);
  await expect(page.locator('#explication')).toContainText('Résultat indicatif');
  expect(erreurs, erreurs.join('\n')).toEqual([]);
});

test('mobile : pas de débordement horizontal, thème sombre et clair', async ({ browser }) => {
  const contexte = await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'fr-FR' });
  const page = await contexte.newPage();
  const erreurs = surveiller(page);
  const a = ADRESSES[0];
  await chercher(page, a.saisie, a.attendu);
  await cliquerMur(page);
  for (const theme of ['clair', 'sombre']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.dispatchEvent(new Event('theme'));
    }, theme);
    const debordement = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(debordement).toBeLessThanOrEqual(1);
  }
  // Aucun texte anglais d'interface connu.
  const texte = await page.locator('body').innerText();
  expect(texte).not.toMatch(/\b(Loading|Search|Share|Floor|Download|Error)\b/);
  expect(erreurs, erreurs.join('\n')).toEqual([]);
  await contexte.close();
});
