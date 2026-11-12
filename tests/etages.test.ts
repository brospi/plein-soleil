import { describe, expect, it } from 'vitest';
import { analyserPoint, aretesDuBatiment, classerAretes, hauteurEtageCalee, azimutDe } from '../src/coeur/facades';
import { Calculateur, REGLAGES_DEFAUT, type SpecFenetre } from '../src/coeur/calcul';
import { decoderEtat, encoderEtat, etatInitial } from '../src/ui/etat';
import { boite, scene, X0, Y0, SOL } from './scenes';

describe('hauteur d’étage calée sur le nombre de niveaux connu', () => {
  it('hauteur divisée par le nombre de niveaux quand le résultat est plausible', () => {
    expect(hauteurEtageCalee(20, 7, 3)).toEqual({ hauteurEtage: 20 / 7, cale: true, base: 'lidar', hauteurBatiment: 20 });
    expect(hauteurEtageCalee(18, 6, 3)).toMatchObject({ hauteurEtage: 3, cale: true });
    // Bornes : 2,4 m et 4,2 m par niveau.
    expect(hauteurEtageCalee(24, 10, 3).cale).toBe(true);
    expect(hauteurEtageCalee(21, 5, 3).cale).toBe(true);
  });
  it('nombre absent ou incohérent avec la hauteur : hauteur par défaut', () => {
    for (const [hauteur, niveaux] of [[20, null], [20, undefined], [20, 0], [6.7, 7], [33.8, 4], [-5, 3]] as Array<[number, number | null | undefined]>) {
      expect(hauteurEtageCalee(hauteur, niveaux, 3)).toMatchObject({ hauteurEtage: 3, cale: false, base: null });
    }
  });
  it('toit LiDAR ou gouttière BD TOPO : la hauteur qui donne l’étage le plus réaliste', () => {
    // Haussmannien sans combles comptés : 22 m au faîte, 18 m à la gouttière, 6 niveaux → 3,0 m (gouttière) plutôt que 3,67 m.
    expect(hauteurEtageCalee(22, 6, 3, 18)).toEqual({ hauteurEtage: 3, cale: true, base: 'gouttiere', hauteurBatiment: 18 });
    // Mêmes hauteurs, combles habités comptés (7 niveaux) → 3,14 m (toit) plutôt que 2,57 m.
    expect(hauteurEtageCalee(22, 7, 3, 18)).toMatchObject({ base: 'lidar', hauteurEtage: 22 / 7 });
    // Une seule des deux est plausible : c'est elle qui sert.
    expect(hauteurEtageCalee(25.2, 6, 3, 23)).toMatchObject({ base: 'gouttiere', hauteurEtage: 23 / 6 });
    // Hauteur BD TOPO incohérente avec le LiDAR à cet endroit (autre aile du bâtiment) : ignorée.
    expect(hauteurEtageCalee(20, 7, 3, 9)).toMatchObject({ base: 'lidar' });
    expect(hauteurEtageCalee(12, 4, 3, 21)).toMatchObject({ base: 'lidar', hauteurEtage: 3 });
  });
});

describe('étages d’un immeuble de 20 m', () => {
  const b = { ...boite('a', -10, 0, 20, 12, 20), etages: 7 };
  const { scene: s } = scene([b]);

  it('sans nombre de niveaux : 3 m par étage, 6 niveaux', () => {
    const an = analyserPoint(s.relief, X0, Y0, 0, -1);
    expect(an.cale).toBe(false);
    expect(an.hauteurEtage).toBe(3);
    expect(an.etages).toHaveLength(6);
  });

  it('7 niveaux connus : 2,86 m par étage, exactement 7 niveaux régulièrement espacés', () => {
    const an = analyserPoint(s.relief, X0, Y0, 0, -1, { hauteurEtage: 3, hauteurCentre: 1.7, niveauxConnus: 7 });
    expect(an.cale).toBe(true);
    expect(an.hauteurEtage).toBeCloseTo(20 / 7, 6);
    expect(an.etages).toHaveLength(7);
    expect(an.etages[0].z).toBeCloseTo(SOL + 1.7, 6);
    expect(an.etages[6].z).toBeCloseTo(SOL + 6 * (20 / 7) + 1.7, 6);
    // Le dernier niveau reste sous le toit et donne sur l'extérieur.
    expect(an.etages[6].z).toBeLessThan(SOL + 20);
    expect(an.etages.every((e) => e.decalage !== null)).toBe(true);
  });

  it('nombre de niveaux incohérent (15 pour 20 m) : ignoré', () => {
    const an = analyserPoint(s.relief, X0, Y0, 0, -1, { hauteurEtage: 3, hauteurCentre: 1.7, niveauxConnus: 15 });
    expect(an.cale).toBe(false);
    expect(an.etages).toHaveLength(6);
  });

  it('les murs de la carte annoncent le nombre de niveaux du bâtiment quand le calage est demandé', () => {
    const aretes = aretesDuBatiment(b, 0);
    classerAretes(aretes, s.relief, { hauteurEtage: 3, hauteurCentre: 1.7, caler: true }, [b]);
    expect(aretes.find((a) => Math.round(azimutDe(a.nx, a.ny)) === 180)!.nbEtages).toBe(7);
    classerAretes(aretes, s.relief, { hauteurEtage: 3, hauteurCentre: 1.7, caler: false }, [b]);
    expect(aretes.find((a) => Math.round(azimutDe(a.nx, a.ny)) === 180)!.nbEtages).toBe(6);
  });

  it('calcul complet : calage par défaut, désactivable, et étage détaillé à la bonne hauteur', () => {
    const calc = new Calculateur(s);
    const spec: SpecFenetre = { x: X0, y: Y0, nx: 0, ny: -1, etage: 6, hauteurLibre: null, niveauxConnus: 7, geometrie: { largeur: 1.2, hauteur: 1.6, embrasure: 0.2, balcon: null } };
    const cale = calc.calculer(spec, REGLAGES_DEFAUT);
    expect(cale.calage).toBe('bdtopo');
    expect(cale.niveauxConnus).toBe(7);
    expect(cale.etages).toHaveLength(7);
    expect(cale.hauteurDetail).toBeCloseTo(6 * (20 / 7) + 1.7, 6);
    expect(cale.detail).not.toBeNull();
    // Réglage manuel : le nombre de niveaux est ignoré, le 7e niveau n'existe plus.
    const manuel = calc.calculer(spec, { ...REGLAGES_DEFAUT, hauteurEtageAuto: false });
    expect(manuel.calage).toBe('defaut');
    expect(manuel.hauteurEtage).toBe(3);
    expect(manuel.etages).toHaveLength(6);
    expect(manuel.motif).toBe('hors-batiment');
    // Sans nombre de niveaux connu : comportement d'origine.
    expect(calc.calculer({ ...spec, etage: 2, niveauxConnus: null }, REGLAGES_DEFAUT).calage).toBe('defaut');
  });
});

describe('lien de partage', () => {
  it('le réglage de calage voyage dans le lien', () => {
    const e = etatInitial();
    e.adresse = { libelle: 'Test', x: 1, y: 2 };
    expect(decoderEtat(encoderEtat(e))!.reglages.hauteurEtageAuto).toBe(true);
    e.reglages.hauteurEtageAuto = false;
    expect(decoderEtat(encoderEtat(e))!.reglages.hauteurEtageAuto).toBe(false);
  });
  it('un lien créé avant le calage garde sa hauteur d’étage fixe', () => {
    const ancien = btoa(JSON.stringify({ v: 1, a: ['Test', 1, 2], r: [3, 0.9, 1, 0.5, 3], i: 0, f: [] }));
    const e = decoderEtat(ancien)!;
    expect(e.reglages.hauteurEtageAuto).toBe(false);
    expect(e.reglages.hauteurEtage).toBe(3);
  });
});
