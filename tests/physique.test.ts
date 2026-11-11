import { describe, expect, it } from 'vitest';
import { Calculateur, REGLAGES_DEFAUT, type SpecFenetre } from '../src/coeur/calcul';
import { ModeArbres, Etat } from '../src/coeur/simulation';
import { boite, scene, X0, Y0, SOL } from './scenes';
import { CRENEAUX_PAR_JOUR, indexDuJour } from '../src/coeur/soleil';
import { type GeometrieFenetre } from '../src/coeur/fenetre';

const NUE: GeometrieFenetre = { largeur: 1.2, hauteur: 1.6, embrasure: 0, balcon: null };

function fenetre(x: number, y: number, nx: number, ny: number, etage: number, geometrie = NUE): SpecFenetre {
  return { x: X0 + x, y: Y0 + y, nx, ny, etage, hauteurLibre: null, geometrie };
}

describe('ordres de grandeur physiques (Paris, ciel clair)', () => {
  // Immeuble isolé de 20 × 12 m, 18 m de haut, sur terrain plat.
  const isole = scene([boite('a', -10, 0, 20, 12, 18)]);
  const calc = new Calculateur(isole.scene);

  it('façade sud dégagée : environ 3 600 h/an', () => {
    const r = calc.calculer(fenetre(0, 0, 0, -1, 3), REGLAGES_DEFAUT);
    const h = r.detail!.indicateurs.heuresAn;
    expect(h).toBeGreaterThan(3450);
    expect(h).toBeLessThan(3750);
    expect(r.detail!.indicateurs.partDuMaximum).toBeGreaterThan(0.98);
    expect(r.detail!.indicateurs.cielVisible).toBeGreaterThan(0.97);
    expect(r.detail!.indicateurs.joursSansSoleil).toBe(0);
  });

  it('façade nord dégagée : environ 800 h/an, aucune en hiver', () => {
    const r = calc.calculer(fenetre(0, 12, 0, 1, 3), REGLAGES_DEFAUT);
    const i = r.detail!.indicateurs;
    expect(i.heuresAn).toBeGreaterThan(700);
    expect(i.heuresAn).toBeLessThan(950);
    expect(i.moyenneHiver).toBe(0);
    expect(i.moyenneEte).toBeGreaterThan(3);
  });

  it('sud + nord = durée totale du jour ; est ≈ ouest', () => {
    const sud = calc.calculer(fenetre(0, 0, 0, -1, 3), REGLAGES_DEFAUT).detail!.indicateurs.heuresAn;
    const nord = calc.calculer(fenetre(0, 12, 0, 1, 3), REGLAGES_DEFAUT).detail!.indicateurs.heuresAn;
    expect(sud + nord).toBeGreaterThan(4350);
    expect(sud + nord).toBeLessThan(4520);
    const est = calc.calculer(fenetre(10, 6, 1, 0, 3), REGLAGES_DEFAUT).detail!.indicateurs.heuresAn;
    const ouest = calc.calculer(fenetre(-10, 6, -1, 0, 3), REGLAGES_DEFAUT).detail!.indicateurs.heuresAn;
    expect(Math.abs(est - ouest)).toBeLessThan(60);
    expect(est).toBeGreaterThan(2000);
    expect(est).toBeLessThan(2300);
  });

  it('énergie directe par ciel clair plausible pour une façade sud', () => {
    const i = calc.calculer(fenetre(0, 0, 0, -1, 3), REGLAGES_DEFAUT).detail!.indicateurs;
    // Vertical sud, 49° N, ciel toujours clair, trouble de Linke 3 : de l'ordre de 1 300 à 1 700 kWh/m²/an.
    expect(i.energieAn).toBeGreaterThan(1200);
    expect(i.energieAn).toBeLessThan(1800);
  });

  it('embrasure et balcon réduisent l’ensoleillement', () => {
    const nue = calc.calculer(fenetre(0, 0, 0, -1, 3), REGLAGES_DEFAUT).detail!.indicateurs;
    const emb = calc.calculer(fenetre(0, 0, 0, -1, 3, { ...NUE, embrasure: 0.25 }), REGLAGES_DEFAUT).detail!.indicateurs;
    const bal = calc.calculer(fenetre(0, 0, 0, -1, 3, { ...NUE, embrasure: 0.25, balcon: { profondeur: 1.5, degagement: 0.4 } }), REGLAGES_DEFAUT).detail!;
    expect(emb.heuresAn).toBeLessThan(nue.heuresAn);
    expect(emb.heuresEquivalentAn).toBeLessThan(nue.heuresEquivalentAn * 0.95);
    expect(bal.indicateurs.heuresAn).toBeLessThan(emb.heuresAn);
    expect(bal.indicateurs.cielVisible).toBeLessThan(emb.cielVisible - 0.1);
    // À midi au solstice d'été (soleil à 64°), un balcon de 1,5 m masque tout le vitrage.
    const etat = bal.etats![indexDuJour(6, 21) * CRENEAUX_PAR_JOUR + Math.round((13 * 60 + 50) / 2)];
    expect(etat).toBe(Etat.OmbrePropre);
  });
});

describe('rue étroite', () => {
  // Rue est-ouest de 10 m de large ; façade étudiée orientée au sud, immeuble de 21 m en face.
  const rue = scene([boite('a', -40, 0, 80, 12, 21), boite('face', -40, -22, 80, 12, 21)]);
  const calc = new Calculateur(rue.scene);
  const r = calc.calculer(fenetre(0, 0, 0, -1, 0), REGLAGES_DEFAUT);

  it('l’ensoleillement croît avec l’étage', () => {
    const heures = r.etages.filter((e) => e.valide).map((e) => e.indicateurs!.heuresAn);
    expect(heures.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < heures.length; i++) expect(heures[i]).toBeGreaterThanOrEqual(heures[i - 1]);
    expect(heures[heures.length - 1]).toBeGreaterThan(heures[0] * 1.5);
    const ciel = r.etages.map((e) => e.indicateurs!.cielVisible);
    for (let i = 1; i < ciel.length; i++) expect(ciel[i]).toBeGreaterThan(ciel[i - 1]);
  });

  it('rez-de-chaussée sans soleil au cœur de l’hiver', () => {
    // Obstacle de 21 − 1,7 m à 10 m : horizon ≈ 62° plein sud, bien au-dessus du soleil de décembre (18°).
    const j = indexDuJour(12, 21);
    expect(r.detail!.heuresJour[j]).toBe(0);
    expect(r.detail!.indicateurs.joursSansSoleil).toBeGreaterThan(60);
    const midi = r.detail!.etats![j * CRENEAUX_PAR_JOUR + Math.round((12 * 60 + 50) / 2)];
    expect(midi).toBe(Etat.OmbreBati);
  });

  it('recalcul d’un étage en moins de 100 ms', () => {
    calc.calculer(fenetre(0, 0, 0, -1, 2), REGLAGES_DEFAUT, false); // mise en cache des enveloppes
    const t0 = performance.now();
    const rapide = calc.calculer(fenetre(0, 0, 0, -1, 4), REGLAGES_DEFAUT, false);
    const duree = performance.now() - t0;
    expect(rapide.detail).not.toBeNull();
    expect(duree).toBeLessThan(100);
  });
});

describe('arbres', () => {
  it('trois modes : ignorés ≥ feuillus ≥ persistants', () => {
    const s = scene([boite('a', -10, 0, 20, 12, 18)]);
    // Rideau d'arbres de 15 m de haut, à 8 m devant la façade sud.
    const { arbres } = s;
    for (let l = 0; l < arbres.hauteur; l++) {
      const y = arbres.y1 - (l + 0.5) * 0.5;
      if (y < Y0 - 8 && y > Y0 - 14) for (let c = 0; c < arbres.largeur; c++) arbres.d[l * arbres.largeur + c] = SOL + 15;
    }
    const calc = new Calculateur(s.scene);
    const f = fenetre(0, 0, 0, -1, 1);
    const sans = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Ignores }).detail!;
    const feuillus = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Feuillus, transmissionHiver: 0.5 }).detail!;
    const opaquesHiver = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Feuillus, transmissionHiver: 0 }).detail!;
    const persistants = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Persistants }).detail!;
    expect(sans.indicateurs.heuresAn).toBeGreaterThan(3400);
    expect(feuillus.indicateurs.heuresAn).toBeLessThan(sans.indicateurs.heuresAn - 300);
    expect(persistants.indicateurs.heuresAn).toBeLessThan(feuillus.indicateurs.heuresAn - 100);
    // Transmission nulle en hiver = persistants.
    expect(Math.abs(opaquesHiver.indicateurs.heuresAn - persistants.indicateurs.heuresAn)).toBeLessThan(1);
    // En janvier, les feuillus laissent passer le soleil, les persistants non.
    const j = indexDuJour(1, 15);
    expect(feuillus.heuresJour[j]).toBeGreaterThan(persistants.heuresJour[j]);
    const midi = persistants.etats![j * CRENEAUX_PAR_JOUR + Math.round((12 * 60 + 50) / 2)];
    expect(midi).toBe(Etat.OmbreArbre);
    // L'énergie traversant les feuillus en hiver est atténuée de moitié.
    expect(feuillus.energieJour[j]).toBeLessThan(sans.energieJour[j] * 0.75);
  });
});
