/**
 * Tests de bout en bout sur des adresses réelles, avec les vrais services de
 * l'IGN (réseau requis). Trois villes : Paris, petite couronne, Lyon ; plus
 * Lille pour le repli sans LiDAR HD.
 */
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';

interface Api {
  scene(): { mode: string; avertissements: string[]; x: number; y: number } | null;
  deplacerCarte(dx: number, dy: number): void;
  camera3d(): { mode: 'fenetre' | 'ensemble'; x: number; y: number; z: number; cap: number; site: number; champ: number } | null;
  resultat(): {
    dureeMs: number;
    fenetres: Array<{
      detail: { indicateurs: { heuresAn: number; heuresRefAn: number; cielVisible: number; energieAn: number; moyenneHiver: number; moyenneEte: number } } | null;
      etages: Array<{ valide: boolean; indicateurs: { heuresAn: number } | null }>;
      chrono: { horizon: number; simulation: number };
      hauteurDetail: number;
      azNormale: number;
      calage: 'bdtopo' | 'defaut';
      hauteurEtage: number;
      niveauxConnus: number | null;
    }>;
  } | null;
  etat(): { fenetres: Array<{ etage: number }>; actif: number; reglages: { hauteurEtageAuto: boolean; hauteurEtage: number } };
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

test('mode agrandi : bascule Carte / 3D, et vue depuis la fenêtre choisie', async ({ page }) => {
  const erreurs = surveiller(page);
  const a = ADRESSES[0];
  await chercher(page, a.saisie, a.attendu);
  await cliquerMur(page);

  // En mode agrandi, les onglets restent visibles et cliquables dans les deux sens.
  await page.locator('#plan-agrandir').click();
  await expect(page.locator('.plan')).toHaveClass(/plan--plein/);
  await page.locator('#onglet-3d').click();
  await expect(page.locator('#vue3d-canvas')).toBeVisible();
  await expect(page.locator('#vue3d-message')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.plan')).toHaveClass(/plan--plein/);
  await page.locator('#onglet-carte').click();
  await expect(page.locator('#carte')).toBeVisible();
  await expect(page.locator('#vue3d')).toBeHidden();
  await expect(page.locator('.plan')).toHaveClass(/plan--plein/);
  await page.locator('#onglet-3d').click();
  await expect(page.locator('#vue3d-canvas')).toBeVisible();

  // Vue depuis la fenêtre : l'œil est à la hauteur du centre du vitrage et regarde dans l'axe de la façade.
  const attendu = await page.evaluate(() => {
    const f = window.pleinSoleil.resultat()!.fenetres[0];
    return { hauteur: f.hauteurDetail, az: f.azNormale };
  });
  await expect(page.locator('#v3-fenetre')).toBeEnabled();
  await page.locator('#v3-fenetre').click();
  await expect(page.locator('#v3-fenetre')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#v3-fenetre')).toHaveText('Vue d’ensemble');
  const vue = (await page.evaluate(() => window.pleinSoleil.camera3d()))!;
  expect(vue.mode).toBe('fenetre');
  expect(Math.abs(vue.cap - attendu.az)).toBeLessThan(0.01);
  // Le sol de la vue 3D est l'altitude du terrain au centre de la vue : écart de quelques décimètres au plus.
  expect(Math.abs(vue.y - attendu.hauteur)).toBeLessThan(1.5);
  await expect(page.locator('#carte-aide')).toContainText('depuis la fenêtre');

  // Glisser vers la gauche fait tourner le regard vers la droite ; l'œil ne bouge pas.
  const boite = (await page.locator('#vue3d-canvas').boundingBox())!;
  const cx = boite.x + boite.width / 2;
  const cy = boite.y + boite.height / 3;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 150, cy + 40, { steps: 5 });
  await page.mouse.up();
  const apres = (await page.evaluate(() => window.pleinSoleil.camera3d()))!;
  expect(apres.cap).toBeGreaterThan(vue.cap + 5);
  expect(apres.site).toBeGreaterThan(vue.site + 1);
  expect(Math.hypot(apres.x - vue.x, apres.y - vue.y, apres.z - vue.z)).toBeLessThan(1e-6);
  // Aucune fenêtre n'a été déplacée par ce geste.
  expect(await page.evaluate(() => window.pleinSoleil.etat().fenetres.length)).toBe(1);

  // Retour à la vue d'ensemble, puis sortie du mode agrandi.
  await page.locator('#v3-fenetre').click();
  expect((await page.evaluate(() => window.pleinSoleil.camera3d()))!.mode).toBe('ensemble');
  await page.keyboard.press('Escape');
  await expect(page.locator('.plan')).not.toHaveClass(/plan--plein/);
  expect(erreurs, erreurs.join('\n')).toEqual([]);
});

test('hauteur d’étage calée sur le nombre de niveaux de la BD TOPO, et désactivable', async ({ page }) => {
  const erreurs = surveiller(page);
  await chercher(page, '18 rue Oberkampf 75011 Paris', /Oberkampf/i);
  // On cherche un mur dont l'immeuble a un nombre de niveaux exploitable.
  const boite = (await page.locator('#carte').boundingBox())!;
  const murs = await page.evaluate(({ l, h }) => window.pleinSoleil.murs().filter((m) => m.ecran.x > 30 && m.ecran.y > 60 && m.ecran.x < l - 30 && m.ecran.y < h - 30), { l: boite.width, h: boite.height });
  let cale = false;
  for (const m of murs.slice(0, 8)) {
    const avant = await page.evaluate(() => window.pleinSoleil.resultat());
    await page.mouse.click(boite.x + m.ecran.x, boite.y + m.ecran.y);
    await page.waitForFunction((a) => window.pleinSoleil.resultat() !== null && window.pleinSoleil.resultat() !== a, avant, { timeout: 30_000 });
    cale = await page.evaluate(() => window.pleinSoleil.resultat()!.fenetres[0].calage === 'bdtopo');
    if (cale) break;
  }
  expect(cale, 'au moins un immeuble calé sur la BD TOPO près de l’adresse').toBe(true);
  const r = await page.evaluate(() => {
    const f = window.pleinSoleil.resultat()!.fenetres[0];
    return { niveaux: f.niveauxConnus, hauteurEtage: f.hauteurEtage, etages: f.etages.length };
  });
  console.log(`  ${r.niveaux} niveaux d'après la BD TOPO, ${r.hauteurEtage.toFixed(2)} m par étage`);
  expect(r.etages).toBe(r.niveaux);
  expect(r.hauteurEtage).toBeGreaterThanOrEqual(2.4);
  expect(r.hauteurEtage).toBeLessThanOrEqual(4.2);
  await expect(page.locator('#etage-detail')).toContainText(`${r.niveaux} niveaux d’après la BD TOPO`);

  // Décocher : retour à la hauteur par défaut, et le réglage voyage dans le lien.
  await page.locator('#repli-fenetre summary').click();
  await expect(page.locator('#r-etage-auto')).toBeChecked();
  await expect(page.locator('#etage-auto-aide')).toContainText('BD TOPO');
  await page.locator('#r-etage-auto').uncheck();
  await page.waitForFunction(() => window.pleinSoleil.resultat()!.fenetres[0].calage === 'defaut');
  expect(await page.evaluate(() => window.pleinSoleil.resultat()!.fenetres[0].hauteurEtage)).toBe(3);
  await expect(page.locator('#etage-detail')).toContainText('estimé');
  await page.reload();
  await page.waitForFunction(() => window.pleinSoleil.resultat() !== null, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.pleinSoleil.etat().reglages.hauteurEtageAuto)).toBe(false);

  // Recocher puis saisir une hauteur : la saisie manuelle l'emporte et décoche la case.
  await page.locator('#repli-fenetre summary').click();
  await page.locator('#r-etage-auto').check();
  await page.waitForFunction(() => window.pleinSoleil.resultat()!.fenetres[0].calage === 'bdtopo');
  await page.locator('#r-etage-h').fill('2.7');
  await page.locator('#r-etage-h').blur();
  await page.waitForFunction(() => window.pleinSoleil.resultat()!.fenetres[0].hauteurEtage === 2.7);
  await expect(page.locator('#r-etage-auto')).not.toBeChecked();
  expect(erreurs, erreurs.join('\n')).toEqual([]);
});

test('déplacer la carte charge les bâtiments de la nouvelle zone', async ({ page }) => {
  const erreurs = surveiller(page);
  const a = ADRESSES[0];
  await chercher(page, a.saisie, a.attendu);
  const depart = await page.evaluate(() => ({ x: window.pleinSoleil.scene()!.x, y: window.pleinSoleil.scene()!.y }));

  // Sans fenêtre placée : la zone suit la carte toute seule.
  await page.evaluate(() => window.pleinSoleil.deplacerCarte(230, 0));
  await page.waitForFunction((x0) => Math.abs((window.pleinSoleil.scene()?.x ?? x0) - x0) > 200, depart.x, { timeout: 60_000 });
  await expect(page.locator('#etat-chargement')).toBeHidden();
  await expect(page.locator('#plan-recharger')).toBeHidden();
  // Les murs de la nouvelle zone sont cliquables, là où il n'y en avait pas avant.
  const proche = await page.evaluate(() => window.pleinSoleil.murs()[0].distance);
  expect(proche).toBeLessThan(80);
  await cliquerMur(page);
  const heures = await page.evaluate(() => window.pleinSoleil.resultat()!.fenetres[0].detail?.indicateurs.heuresAn ?? -1);
  expect(heures).toBeGreaterThanOrEqual(0);
  expect(page.url()).toContain('#l=');

  // Avec une fenêtre placée : rien ne se recharge sans accord, les résultats restent.
  const milieu = await page.evaluate(() => window.pleinSoleil.scene()!.x);
  await page.evaluate(() => window.pleinSoleil.deplacerCarte(0, 260));
  await expect(page.locator('#plan-recharger')).toBeVisible();
  expect(await page.evaluate(() => window.pleinSoleil.scene()!.x)).toBe(milieu);
  await expect(page.locator('#resultats')).toBeVisible();
  // Revenir près de la zone fait disparaître la proposition.
  await page.evaluate(() => window.pleinSoleil.deplacerCarte(0, -260));
  await expect(page.locator('#plan-recharger')).toBeHidden();
  // Accepter : la zone est rechargée et la fenêtre devenue hors de portée est retirée.
  await page.evaluate(() => window.pleinSoleil.deplacerCarte(0, 260));
  await page.locator('#plan-recharger').click();
  await page.waitForFunction(() => window.pleinSoleil.etat().fenetres.length === 0, undefined, { timeout: 60_000 });
  await expect(page.locator('#resultats')).toBeHidden();
  await expect(page.locator('#annonce')).toContainText('retirée');
  expect(erreurs, erreurs.join('\n')).toEqual([]);
});

test('erreurs passagères de l’IGN (400 mis en cache, 429) : relance annoncée puis chargement', async ({ page, context }) => {
  const erreurs = surveiller(page);
  // L'IGN renvoie parfois un 400 éclair, avec un cache de 21 jours, sur une requête valide ;
  // on le simule sur le premier appel au relief fin, et un 429 sur le premier appel aux bâtiments.
  let refusMns = 0;
  let refusWfs = 0;
  await context.route(/wms-r\/wms.*LIDAR-HD_MNS.*WIDTH=1024/, async (route) => {
    if (refusMns++ === 0) {
      await route.fulfill({ status: 400, contentType: 'text/xml', headers: { 'Cache-Control': 'private, max-age=1814400', 'Access-Control-Allow-Origin': '*' }, body: '<ServiceExceptionReport/>' });
    } else {
      await route.continue();
    }
  });
  await context.route(/wfs\/ows/, async (route) => {
    if (refusWfs++ === 0) await route.fulfill({ status: 429, headers: { 'Retry-After': '1', 'Access-Control-Allow-Origin': '*' }, body: '' });
    else await route.continue();
  });
  const a = ADRESSES[0];
  await page.goto('./');
  await page.getByLabel('Adresse du logement').fill(a.saisie);
  const premiere = page.locator('#suggestions li[role="option"]').first();
  await expect(premiere).toBeVisible({ timeout: 20_000 });
  await premiere.dispatchEvent('pointerdown');
  // La relance est annoncée à l'utilisateur, puis la scène se charge normalement.
  await expect(page.locator('#etat-chargement')).toContainText(/Nouvelle tentative/, { timeout: 10_000 });
  await page.waitForFunction(() => window.pleinSoleil.scene() !== null, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.pleinSoleil.scene()!.mode)).toBe('lidar');
  expect(refusMns).toBeGreaterThanOrEqual(2);
  expect(refusWfs).toBeGreaterThanOrEqual(2);
  await cliquerMur(page);
  expect(erreurs, erreurs.join('\n')).toEqual([]);
});

test('une erreur mise en cache par le navigateur est contournée par la relance', async ({ page }) => {
  // Une page HTTPS ne peut pas interroger un serveur HTTP local : test réservé au site servi en local.
  test.skip(!!process.env.BASE_URL, 'serveur local injoignable depuis un site distant en HTTPS');
  // Serveur local qui imite l'IGN : un 400 « cachable 21 jours » au premier appel, 200 ensuite.
  let appels = 0;
  const serveur = createServer((_req, res) => {
    appels++;
    res.writeHead(appels === 1 ? 400 : 200, { 'Cache-Control': 'private, max-age=1814400', 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
    res.end(appels === 1 ? 'erreur' : 'relief');
  });
  await new Promise<void>((pret) => serveur.listen(0, '127.0.0.1', pret));
  const url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/tuile`;
  try {
    await page.goto('./');
    const statuts = await page.evaluate(async (u) => {
      const lire = async (cache: RequestCache) => (await fetch(u, { cache })).status;
      // Même séquence que le module réseau : premier essai normal, relance en mode « reload ».
      const premier = await lire('default');
      const sansPrecaution = await lire('default');
      const relance = await lire('reload');
      const ensuite = await lire('default');
      return { premier, sansPrecaution, relance, ensuite };
    }, url);
    console.log(`  statuts : ${JSON.stringify(statuts)}, appels réellement reçus par le serveur : ${appels}`);
    expect(statuts.premier).toBe(400);
    // La relance atteint le serveur, obtient la donnée, et répare l'entrée du cache.
    expect(statuts.relance).toBe(200);
    expect(statuts.ensuite).toBe(200);
  } finally {
    serveur.close();
  }
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
