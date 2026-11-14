import { describe, expect, it } from 'vitest';
import { estPersistant, marquerPersistants } from '../src/coeur/arbres';
import { creerRaster, SANS_DONNEE } from '../src/coeur/raster';
import { LYON, PARIS, sourceInventaire } from '../src/donnees/inventaire';
import { versLambert93 } from '../src/coeur/lambert93';
import { Calculateur, REGLAGES_DEFAUT, type SpecFenetre } from '../src/coeur/calcul';
import { ModeArbres } from '../src/coeur/simulation';
import { indexDuJour } from '../src/coeur/soleil';
import { boite, scene, X0, Y0, SOL } from './scenes';

describe('feuillage persistant d’après le genre et l’espèce', () => {
  it('conifères et feuillus persistants', () => {
    for (const [g, e] of [['Pinus', 'nigra'], ['Cedrus', 'atlantica'], ['Cupressus', 'sempervirens'], ['Taxus', 'baccata'], ['Ilex', 'aquifolium'], ['Olea', 'europaea'], ['x Cupressocyparis', 'leylandii'], ['PINUS', 'sylvestris']]) {
      expect(estPersistant(g, e), `${g} ${e}`).toBe(true);
    }
  });
  it('genres caducs les plus plantés à Paris, et conifères caducs', () => {
    for (const [g, e] of [['Platanus', 'x hispanica'], ['Aesculus', 'hippocastanum'], ['Tilia', 'tomentosa'], ['Acer', 'platanoides'], ['Styphnolobium', 'japonicum'], ['Prunus', 'serrulata'], ['Fraxinus', 'excelsior'], ['Celtis', 'australis'], ['Pyrus', 'calleryana'], ['Ginkgo', 'biloba'], ['Larix', 'decidua'], ['Metasequoia', 'glyptostroboides'], ['Taxodium', 'distichum']]) {
      expect(estPersistant(g, e), `${g} ${e}`).toBe(false);
    }
  });
  it('l’espèce tranche dans les genres mixtes', () => {
    expect(estPersistant('Quercus', 'ilex')).toBe(true);
    expect(estPersistant('Quercus', 'robur')).toBe(false);
    expect(estPersistant('Magnolia', 'grandiflora')).toBe(true);
    expect(estPersistant('Magnolia', 'kobus')).toBe(false);
    expect(estPersistant('Prunus', 'laurocerasus')).toBe(true);
    expect(estPersistant('Ligustrum', "lucidum 'Excelsum Superbum'")).toBe(true);
  });
  it('genre absent : considéré comme caduc (le réglage général s’applique)', () => {
    expect(estPersistant('', '')).toBe(false);
    expect(estPersistant(null, null)).toBe(false);
    expect(estPersistant('Inconnu', 'sp.')).toBe(false);
  });
});

describe('rattachement de la canopée aux arbres recensés', () => {
  // Grille de 40 × 40 m au pas de 0,5 m : un pin à l'ouest, un platane à l'est, un arbre privé non recensé au sud.
  const arbres = creerRaster(0, 40, 0.5, 80, 80, SANS_DONNEE);
  const disque = (cx: number, cy: number, r: number, h: number): void => {
    for (let l = 0; l < 80; l++) for (let c = 0; c < 80; c++) if (Math.hypot((c + 0.5) * 0.5 - cx, 40 - (l + 0.5) * 0.5 - cy) <= r) arbres.d[l * 80 + c] = h;
  };
  disque(10, 30, 4, 45);
  disque(18, 30, 4, 50);
  disque(30, 8, 4, 42);
  const inventaire = [
    { x: 10, y: 30, genre: 'Pinus', espece: 'nigra' },
    { x: 18, y: 30, genre: 'Platanus', espece: 'x hispanica' },
  ];
  const { persistants, bilan } = marquerPersistants(arbres, inventaire);
  const en = (x: number, y: number): number => persistants.d[Math.floor((40 - y) / 0.5) * 80 + Math.floor(x / 0.5)];

  it('seule la canopée du pin est marquée persistante', () => {
    expect(en(8, 30)).toBe(45);
    expect(en(10, 32)).toBe(45);
    expect(en(20, 30)).toBe(SANS_DONNEE);
    expect(en(30, 8)).toBe(SANS_DONNEE);
  });
  it('entre deux arbres, chaque cellule va au plus proche', () => {
    // Les houppiers se touchent à x = 14 : à gauche le pin, à droite le platane.
    expect(en(13.2, 30)).not.toBe(SANS_DONNEE);
    expect(en(14.8, 30)).toBe(SANS_DONNEE);
  });
  it('bilan : arbres recensés, persistants, part de canopée identifiée', () => {
    expect(bilan.recenses).toBe(2);
    expect(bilan.persistants).toBe(1);
    // Deux houppiers sur trois sont identifiés ; l'arbre privé ne l'est pas.
    expect(bilan.partIdentifiee).toBeGreaterThan(0.6);
    expect(bilan.partIdentifiee).toBeLessThan(0.72);
    expect(bilan.partPersistante).toBeGreaterThan(0.25);
    expect(bilan.partPersistante).toBeLessThan(0.4);
  });
  it('le rayon de couronne de l’inventaire borne le rattachement', () => {
    const r = marquerPersistants(arbres, [{ x: 10, y: 30, genre: 'Pinus', espece: 'nigra', rayon: 1 }]);
    // Rayon 1 m + 2 m de marge : la cellule à 3,5 m du tronc n'est plus rattachée.
    expect(r.persistants.d[Math.floor((40 - 30) / 0.5) * 80 + Math.floor(13.6 / 0.5)]).toBe(SANS_DONNEE);
    expect(r.persistants.d[Math.floor((40 - 30) / 0.5) * 80 + Math.floor(11 / 0.5)]).toBe(45);
  });
});

describe('sources d’inventaire', () => {
  it('Paris et Lyon sont reconnus, pas le reste', () => {
    const l93 = (lon: number, lat: number) => versLambert93(lon, lat);
    expect(sourceInventaire(l93(2.3737, 48.8548).x, l93(2.3737, 48.8548).y)?.nom).toBe('Ville de Paris');
    expect(sourceInventaire(l93(4.8336, 45.7689).x, l93(4.8336, 45.7689).y)?.nom).toBe('Métropole de Lyon');
    expect(sourceInventaire(l93(2.4407, 48.8585).x, l93(2.4407, 48.8585).y)?.nom).toBe('Ville de Paris'); // limite de Montreuil : dans le rectangle parisien, l'inventaire y sera simplement vide
    expect(sourceInventaire(l93(5.4296, 43.3187).x, l93(5.4296, 43.3187).y)).toBeNull();
    expect(sourceInventaire(l93(3.0635, 50.6366).x, l93(3.0635, 50.6366).y)).toBeNull();
  });
  it('lecture des réponses de Paris et de Lyon', () => {
    const paris = PARIS.lire([
      { geo_point_2d: { lon: 2.3499, lat: 48.853 }, genre: 'Cedrus', espece: 'atlantica' },
      { geo_point_2d: null, genre: 'Tilia', espece: 'cordata' },
      { geo_point_2d: { lon: 2.35, lat: 48.8531 }, genre: null, espece: null },
    ]);
    expect(paris).toHaveLength(2);
    expect(paris[0].x).toBeCloseTo(652296.97, 1);
    expect(paris[0].y).toBeCloseTo(6861636.36, 1);
    expect(paris[1].genre).toBe('');
    const lyon = LYON.lire({ features: [{ geometry: { type: 'Point', coordinates: [842272.5, 6520310.2] }, properties: { genre: 'Cupressus', espece: 'sempervirens', rayoncouronne_m: 1 } }, { geometry: null, properties: {} }] });
    expect(lyon).toEqual([{ x: 842272.5, y: 6520310.2, genre: 'Cupressus', espece: 'sempervirens', rayon: 1 }]);
    expect(PARIS.lire({ erreur: true })).toEqual([]);
    expect(LYON.lire(null)).toEqual([]);
  });
  it('les requêtes couvrent l’emprise demandée', () => {
    const url = decodeURIComponent(PARIS.url(652000, 6861500, 652512, 6862012));
    const m = /in_bbox\(geo_point_2d,([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/.exec(url)!;
    const [lat0, lon0, lat1, lon1] = m.slice(1).map(Number);
    expect(lat0).toBeLessThan(48.853);
    expect(lat1).toBeGreaterThan(48.853);
    expect(lon0).toBeLessThan(2.35);
    expect(lon1).toBeGreaterThan(2.35);
    expect(LYON.url(842244.3, 6520244.7, 842756.2, 6520756.1)).toContain('BBOX=842244,6520244,842757,6520757,EPSG:2154');
  });
});

describe('effet sur l’ensoleillement', () => {
  // Immeuble isolé, rideau d'arbres de 15 m à 8 m devant la façade sud.
  const s = scene([boite('a', -10, 0, 20, 12, 18)]);
  const { arbres } = s;
  for (let l = 0; l < arbres.hauteur; l++) {
    const y = arbres.y1 - (l + 0.5) * 0.5;
    if (y < Y0 - 8 && y > Y0 - 14) for (let c = 0; c < arbres.largeur; c++) arbres.d[l * arbres.largeur + c] = SOL + 15;
  }
  const f: SpecFenetre = { x: X0, y: Y0, nx: 0, ny: -1, etage: 1, hauteurLibre: null, geometrie: { largeur: 1.2, hauteur: 1.6, embrasure: 0, balcon: null } };
  const janvier = indexDuJour(1, 15);
  const juillet = indexDuJour(7, 15);

  it('rideau de persistants recensés : opaque en hiver même en mode « feuillus »', () => {
    // Tout le rideau est déclaré persistant par l'inventaire.
    const pers = creerRaster(arbres.x0, arbres.y1, arbres.pas, arbres.largeur, arbres.hauteur, SANS_DONNEE);
    pers.d.set(arbres.d);
    const calc = new Calculateur({ ...s.scene, niveaux: [{ ...s.scene.niveaux[0], persistants: pers }] });
    const feuillus = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Feuillus }).detail!;
    const toutPersistant = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Persistants }).detail!;
    const sansInventaire = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Feuillus, inventaireArbres: false }).detail!;
    const ignores = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Ignores }).detail!;
    // Avec l'inventaire, « feuillus » se comporte comme « persistants » pour ces arbres.
    expect(Math.abs(feuillus.indicateurs.heuresAn - toutPersistant.indicateurs.heuresAn)).toBeLessThan(1);
    expect(feuillus.heuresJour[janvier]).toBe(toutPersistant.heuresJour[janvier]);
    // Sans l'inventaire, la lumière d'hiver filtrerait à travers les branches.
    expect(sansInventaire.heuresJour[janvier]).toBeGreaterThan(feuillus.heuresJour[janvier] + 1);
    // En été, aucune différence : les arbres sont en feuilles de toute façon.
    expect(sansInventaire.heuresJour[juillet]).toBe(feuillus.heuresJour[juillet]);
    // « Ignorés » ignore aussi les persistants.
    expect(ignores.indicateurs.heuresAn).toBeGreaterThan(3400);
  });

  it('rideau de caducs (aucun persistant recensé) : l’inventaire ne change rien', () => {
    const vide = creerRaster(arbres.x0, arbres.y1, arbres.pas, arbres.largeur, arbres.hauteur, SANS_DONNEE);
    const calc = new Calculateur({ ...s.scene, niveaux: [{ ...s.scene.niveaux[0], persistants: vide }] });
    const avec = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Feuillus }).detail!;
    const sans = calc.calculer(f, { ...REGLAGES_DEFAUT, arbres: ModeArbres.Feuillus, inventaireArbres: false }).detail!;
    expect(avec.indicateurs.heuresAn).toBe(sans.indicateurs.heuresAn);
    expect(avec.indicateurs.energieAn).toBe(sans.indicateurs.energieAn);
  });
});
