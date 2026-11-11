// Captures d'écran pour la revue visuelle : node e2e/captures.mjs <dossier>
import { chromium } from '@playwright/test';
const dossier = process.argv[2] ?? 'captures';
const base = process.env.BASE ?? 'http://localhost:4173';
const navigateur = await chromium.launch();

async function ouvrir(contexte, saisie) {
  const page = await contexte.newPage();
  await page.goto(base);
  await page.getByLabel('Adresse du logement').fill(saisie);
  const premiere = page.locator('#suggestions li[role="option"]').first();
  await premiere.waitFor({ timeout: 20000 });
  await premiere.dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.pleinSoleil.scene() !== null, undefined, { timeout: 60000 });
  const boite = await page.locator('#carte').boundingBox();
  const mur = await page.evaluate(({ l, h }) => window.pleinSoleil.murs().find((m) => m.ecran.x > 30 && m.ecran.y > 60 && m.ecran.x < l - 30 && m.ecran.y < h - 30), { l: boite.width, h: boite.height });
  await page.mouse.click(boite.x + mur.ecran.x, boite.y + mur.ecran.y);
  await page.waitForFunction(() => window.pleinSoleil.resultat() !== null);
  await page.waitForTimeout(800);
  return page;
}

// Bureau, thème clair.
let ctx = await navigateur.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'light', locale: 'fr-FR' });
let page = await ouvrir(ctx, '18 rue Oberkampf 75011 Paris');
await page.screenshot({ path: `${dossier}/bureau-clair-haut.png` });
await page.screenshot({ path: `${dossier}/bureau-clair-page.png`, fullPage: true });
// 3D plein écran, juin 16 h, puis photo aérienne.
await page.locator('#onglet-3d').click();
await page.locator('#plan-agrandir').click();
await page.locator('#vue3d-message').waitFor({ state: 'hidden', timeout: 30000 });
await page.evaluate(() => {
  const d = document.getElementById('v3-date'); d.value = 100; d.dispatchEvent(new Event('input'));
  const h = document.getElementById('v3-heure'); h.value = 990; h.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dossier}/3d-couleurs.png` });
await page.locator('#v3-texture').click();
await page.waitForTimeout(4000);
await page.screenshot({ path: `${dossier}/3d-photo.png` });
await ctx.close();

// Mobile, thème sombre.
ctx = await navigateur.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'fr-FR' });
page = await ouvrir(ctx, '18 rue Oberkampf 75011 Paris');
await page.screenshot({ path: `${dossier}/mobile-sombre-page.png`, fullPage: true });
await ctx.close();
await navigateur.close();
