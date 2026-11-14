/**
 * Tests d'intégration sur les données réelles de l'IGN (réseau requis).
 * Lancés seulement avec RESEAU=1 : `RESEAU=1 npx vitest run tests/reel.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { chargerScene } from '../src/moteur/scene';
import { accesNode } from './acces-node';
import { ETAGES_DEFAUT, azimutDe, areteLaPlusProche } from '../src/coeur/facades';
import { Calculateur, REGLAGES_DEFAUT } from '../src/coeur/calcul';
import { tableSolaire } from '../src/coeur/soleil';
import { depuisLambert93, convergenceMeridiens, versLambert93 } from '../src/coeur/lambert93';
import { FENETRE_DEFAUT } from '../src/coeur/fenetre';

const reseau = process.env.RESEAU === '1';

async function etudier(nom: string, lon: number, lat: number) {
  const { x, y } = versLambert93(lon, lat);
  const t0 = performance.now();
  const sc = await chargerScene(x, y, accesNode, ETAGES_DEFAUT);
  const tCharge = performance.now() - t0;
  const geo = depuisLambert93(x, y);
  const calc = new Calculateur({ niveaux: sc.niveaux, relief: sc.relief, table: tableSolaire(geo.lat, geo.lon), convergence: convergenceMeridiens(geo.lon) });
  const libres = sc.aretes.filter((a) => a.statut === 'libre');
  const mitoyens = sc.aretes.filter((a) => a.statut === 'mitoyen');
  console.log(`\n${nom} — mode ${sc.mode}, chargement ${tCharge.toFixed(0)} ms, ${sc.batiments.length} bâtiments, ${libres.length} arêtes libres, ${mitoyens.length} mitoyennes`);
  for (const a of sc.avertissements) console.log('  ⚠', a);
  const proche = areteLaPlusProche(sc.aretes, x, y, 60, (a) => a.statut === 'libre' && a.longueur > 4)!;
  const spec = { x: proche.x, y: proche.y, nx: proche.arete.nx, ny: proche.arete.ny, etage: Math.max(proche.arete.etageMin, 2), hauteurLibre: null, geometrie: FENETRE_DEFAUT };
  const t1 = performance.now();
  const r = calc.calculer(spec, REGLAGES_DEFAUT);
  const tCalc = performance.now() - t1;
  console.log(`  façade az ${azimutDe(proche.arete.nx, proche.arete.ny).toFixed(0)}°, sol ${r.sol.toFixed(1)} m, toit +${(r.toit - r.sol).toFixed(1)} m, calcul ${tCalc.toFixed(0)} ms (horizon ${r.chrono.horizon.toFixed(0)} ms)`);
  for (const e of r.etages) {
    const i = e.indicateurs;
    console.log(`  étage ${e.etage} (${e.hauteur.toFixed(1)} m) : ${i ? `${i.heuresAn.toFixed(0)} h/an, hiver ${i.moyenneHiver.toFixed(2)} h/j, été ${i.moyenneEte.toFixed(2)} h/j, ciel ${(i.cielVisible * 100).toFixed(0)} %, max ${(i.partDuMaximum * 100).toFixed(0)} %` : 'non valide'}`);
  }
  return { sc, r, tCharge, tCalc };
}

describe.skipIf(!reseau)('données réelles IGN', () => {
  it('Paris 20e : cèdres recensés par la Ville, opaques toute l’année', async () => {
    // Rue Julien Lacroix : un cèdre de l'Atlas de 15 m figure dans l'inventaire des arbres d'alignement.
    const { x, y } = versLambert93(2.386092964743129, 48.86850399011441);
    const sc = await chargerScene(x, y, accesNode, ETAGES_DEFAUT);
    expect(sc.mode).toBe('lidar');
    expect(sc.inventaire?.source).toBe('Ville de Paris');
    console.log(`\nInventaire Paris 20e : ${sc.inventaire!.recenses} arbres recensés, ${sc.inventaire!.persistants} persistants, ${(sc.inventaire!.partIdentifiee * 100).toFixed(0)} % de la canopée identifiée, ${(sc.inventaire!.partPersistante * 100).toFixed(1)} % persistante`);
    expect(sc.inventaire!.recenses).toBeGreaterThan(20);
    expect(sc.inventaire!.persistants).toBeGreaterThanOrEqual(1);
    expect(sc.inventaire!.partPersistante).toBeGreaterThan(0);
    // De la canopée persistante existe bien dans un rayon de 10 m autour du cèdre.
    const pers = sc.niveaux[0].persistants!;
    let cellules = 0;
    for (let l = 0; l < pers.hauteur; l++) {
      for (let c = 0; c < pers.largeur; c++) {
        if (pers.d[l * pers.largeur + c] > -1000 && Math.hypot(pers.x0 + (c + 0.5) * pers.pas - x, pers.y1 - (l + 0.5) * pers.pas - y) < 10) cellules++;
      }
    }
    expect(cellules).toBeGreaterThan(20);
    // Les façades proches du cèdre : l'inventaire ne peut que réduire le soleil d'hiver, jamais l'augmenter.
    const geo = depuisLambert93(x, y);
    const calc = new Calculateur({ niveaux: sc.niveaux, relief: sc.relief, table: tableSolaire(geo.lat, geo.lon), convergence: convergenceMeridiens(geo.lon) });
    const murs = sc.aretes.filter((a) => a.statut === 'libre' && a.longueur > 4 && Math.hypot((a.ax + a.bx) / 2 - x, (a.ay + a.by) / 2 - y) < 40);
    let ecartMax = 0;
    for (const a of murs.slice(0, 25)) {
      const spec = { x: (a.ax + a.bx) / 2, y: (a.ay + a.by) / 2, nx: a.nx, ny: a.ny, etage: Math.max(a.etageMin, 1), hauteurLibre: null, geometrie: FENETRE_DEFAUT };
      const avec = calc.calculer(spec, REGLAGES_DEFAUT, false).detail;
      const sans = calc.calculer(spec, { ...REGLAGES_DEFAUT, inventaireArbres: false }, false).detail;
      if (!avec || !sans) continue;
      expect(avec.indicateurs.heuresAn).toBeLessThanOrEqual(sans.indicateurs.heuresAn + 1e-6);
      const ecart = sans.indicateurs.heuresAn - avec.indicateurs.heuresAn;
      if (ecart > ecartMax) ecartMax = ecart;
      if (ecart > 5) console.log(`  façade az ${azimutDe(a.nx, a.ny).toFixed(0)}° : ${sans.indicateurs.heuresAn.toFixed(0)} h/an sans l'inventaire, ${avec.indicateurs.heuresAn.toFixed(0)} h avec (hiver ${sans.indicateurs.moyenneHiver.toFixed(2)} → ${avec.indicateurs.moyenneHiver.toFixed(2)} h/j)`);
    }
    console.log(`  écart maximal sur ${Math.min(25, murs.length)} façades voisines : ${ecartMax.toFixed(0)} h/an`);
  }, 120_000);

  it('Paris (LiDAR HD)', async () => {
    const { sc, r } = await etudier('Paris, rue de Rivoli', 2.3604077, 48.8554814);
    expect(sc.mode).toBe('lidar');
    expect(sc.batiments.length).toBeGreaterThan(5);
    expect(sc.aretes.some((a) => a.statut === 'mitoyen')).toBe(true);
    const valides = r.etages.filter((e) => e.valide);
    expect(valides.length).toBeGreaterThanOrEqual(3);
    // L'ensoleillement ne décroît pas sensiblement en montant.
    const h = valides.map((e) => e.indicateurs!.heuresAn);
    expect(h[h.length - 1]).toBeGreaterThanOrEqual(h[0]);
  }, 120_000);

  it('Lyon (LiDAR HD)', async () => {
    const { sc, r } = await etudier('Lyon, Croix-Rousse', 4.8320, 45.7745);
    expect(sc.mode).toBe('lidar');
    expect(r.etages.some((e) => e.valide)).toBe(true);
  }, 120_000);

  it('Lille (repli BD TOPO, sans LiDAR HD)', async () => {
    const { sc, r } = await etudier('Lille, centre', 3.0635, 50.6366);
    expect(sc.mode).toBe('bdtopo');
    expect(sc.avertissements[0]).toContain('LiDAR HD');
    expect(r.etages.some((e) => e.valide)).toBe(true);
  }, 120_000);
});
