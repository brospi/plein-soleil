import { describe, expect, test } from 'vitest';
import { ClasseLas, TAILLE_ENTETE, type EnteteCopc, type Noeud, cleNoeud, empriseNoeud, extrairePoints, lireEntete, lireHierarchie } from '../src/donnees/copc';
import { FACTEUR_MAX, choisirNoeuds, couleursPoints, lireIndexDalles, positionsVue, type DalleNuage } from '../src/moteur/nuage';

/** En-tête LAS 1.4 + VLR d'information COPC, comme ceux des dalles LiDAR HD (1 km², cube de 1000 m). */
function enteteSynthetique(): Uint8Array {
  const o = new Uint8Array(TAILLE_ENTETE);
  const v = new DataView(o.buffer);
  o.set([...'LASF'].map((c) => c.charCodeAt(0)), 0);
  o[104] = 6 | 0x80;
  v.setUint16(105, 30, true);
  v.setBigUint64(247, 17_588_504n, true);
  [0.01, 0.01, 0.01].forEach((s, i) => v.setFloat64(131 + 8 * i, s, true));
  [0, 0, 0].forEach((s, i) => v.setFloat64(155 + 8 * i, s, true));
  v.setFloat64(179, 655000, true);
  v.setFloat64(187, 654000, true);
  v.setFloat64(195, 6863000, true);
  v.setFloat64(203, 6862000, true);
  v.setFloat64(211, 98.24, true);
  v.setFloat64(219, 30.87, true);
  o.set([...'copc'].map((c) => c.charCodeAt(0)), 377);
  v.setUint16(393, 1, true);
  [654500, 6862500, 530.87, 500, 6.8].forEach((x, i) => v.setFloat64(429 + 8 * i, x, true));
  v.setBigUint64(469, 115_291_143n, true);
  v.setBigUint64(477, 12_128n, true);
  return o;
}

function hierarchie(noeuds: Noeud[]): Uint8Array {
  const o = new Uint8Array(noeuds.length * 32);
  const v = new DataView(o.buffer);
  noeuds.forEach((n, k) => {
    const b = k * 32;
    v.setInt32(b, n.d, true);
    v.setInt32(b + 4, n.x, true);
    v.setInt32(b + 8, n.y, true);
    v.setInt32(b + 12, n.z, true);
    v.setBigUint64(b + 16, BigInt(n.position), true);
    v.setInt32(b + 24, n.taille, true);
    v.setInt32(b + 28, n.points, true);
  });
  return o;
}

/** Octree complet à plat (z = 0), avec ~4 fois plus de points à chaque niveau, comme une dalle de Paris. */
function dalleSynthetique(url: string, entete: EnteteCopc, profondeur = 4): DalleNuage {
  const noeuds: Noeud[] = [];
  for (let d = 0; d <= profondeur; d++) {
    const n = 2 ** d;
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) noeuds.push({ d, x, y, z: 0, position: 1000, taille: 100, points: 70_000 });
  }
  return { url, entete, noeuds };
}

describe('lecture COPC', () => {
  test('en-tête et cube de l’octree', () => {
    const e = lireEntete(enteteSynthetique());
    expect(e.formatPoint).toBe(6);
    expect(e.longueurPoint).toBe(30);
    expect(e.nombrePoints).toBe(17_588_504);
    expect(e.min).toEqual([654000, 6862000, 30.87]);
    expect(e.max).toEqual([655000, 6863000, 98.24]);
    expect(e.centre).toEqual([654500, 6862500, 530.87]);
    expect(e.demiCote).toBe(500);
    expect(e.espacement).toBe(6.8);
    expect(e.pageRacine).toEqual({ position: 115_291_143, taille: 12_128 });
  });

  test('refuse un fichier qui n’est pas un COPC', () => {
    const o = enteteSynthetique();
    o[377] = 'x'.charCodeAt(0);
    expect(() => lireEntete(o)).toThrow(/COPC/);
    expect(() => lireEntete(new Uint8Array(100))).toThrow();
  });

  test('page de hiérarchie et emprise des nœuds', () => {
    const noeuds: Noeud[] = [
      { d: 0, x: 0, y: 0, z: 0, position: 1418, taille: 770_740, points: 69_620 },
      { d: 2, x: 3, y: 1, z: 0, position: 9_000_000, taille: 1_000, points: -1 },
    ];
    expect(lireHierarchie(hierarchie(noeuds))).toEqual(noeuds);
    const e = lireEntete(enteteSynthetique());
    expect(cleNoeud(noeuds[1])).toBe('2-3-1-0');
    // Niveau 2 : cases de 250 m ; x = 3 (est), y = 1 (deuxième rangée en partant du sud).
    expect(empriseNoeud(e, noeuds[1])).toEqual({ x0: 654750, y0: 6862250, x1: 655000, y1: 6862500 });
  });

  test('points : coordonnées relatives, classes, points retenus et artefacts écartés', () => {
    const e = lireEntete(enteteSynthetique());
    const brut = new Uint8Array(4 * 30);
    const v = new DataView(brut.buffer);
    const point = (i: number, x: number, y: number, z: number, classe: number, retenu = false): void => {
      v.setInt32(i * 30, Math.round(x / 0.01), true);
      v.setInt32(i * 30 + 4, Math.round(y / 0.01), true);
      v.setInt32(i * 30 + 8, Math.round(z / 0.01), true);
      v.setUint16(i * 30 + 12, 1000 + i, true);
      brut[i * 30 + 15] = retenu ? 0x04 : 0;
      brut[i * 30 + 16] = classe;
    };
    point(0, 654100.5, 6862200.25, 45.1, ClasseLas.Sol);
    point(1, 654101, 6862201, 60, ClasseLas.Batiment);
    point(2, 654102, 6862202, 50, ClasseLas.Artefact);
    point(3, 654103, 6862203, 50, ClasseLas.Sol, true);
    const p = extrairePoints(brut, e, { x: 654000, y: 6862000 });
    expect(p.nombre).toBe(2);
    expect([...p.xyz].map((x) => Math.round(x * 100) / 100)).toEqual([100.5, 200.25, 45.1, 101, 201, 60]);
    expect([...p.classe]).toEqual([ClasseLas.Sol, ClasseLas.Batiment]);
    expect([...p.intensite]).toEqual([1000, 1001]);
    // Repère de la vue : x est, y altitude, z sud.
    expect([...positionsVue(p)].map((x) => Math.round(x * 100) / 100)).toEqual([100.5, 45.1, -200.25, 101, 60, -201]);
    const c = couleursPoints(p);
    expect(c.length).toBe(6);
    // Bâti plus clair que le sol.
    expect(c[3] + c[4] + c[5]).toBeGreaterThan(c[0] + c[1] + c[2]);
  });
});

describe('choix des nœuds', () => {
  const e = lireEntete(enteteSynthetique());
  const dalle = dalleSynthetique('a.copc.laz', e);
  const cx = 654300;
  const cy = 6862700;

  test('détail décroissant avec la distance, du plus grossier au plus fin', () => {
    const s = choisirNoeuds([dalle], cx, cy, 460, 1e9);
    expect(s.facteur).toBe(FACTEUR_MAX);
    const niveaux = s.choix.map((c) => c.noeud.d);
    expect(niveaux).toEqual([...niveaux].sort((a, b) => a - b));
    // Seul le nœud fin qui contient le centre est à distance nulle ; les nœuds fins chargés sont proches.
    const fins = s.choix.filter((c) => c.noeud.d === 4);
    expect(fins.length).toBeGreaterThan(0);
    for (const c of fins) expect(c.distance).toBeLessThanOrEqual(FACTEUR_MAX * (6.8 / 16));
    expect(fins.length).toBeLessThan(256);
    expect(new Set(s.choix.map((c) => c.cle)).size).toBe(s.choix.length);
  });

  test('le budget de points réduit le détail', () => {
    const large = choisirNoeuds([dalle], cx, cy, 460, 1e9);
    const serre = choisirNoeuds([dalle], cx, cy, 460, 2_000_000);
    expect(serre.points).toBeLessThanOrEqual(2_000_000);
    expect(serre.facteur).toBeLessThan(large.facteur);
    expect(serre.choix.length).toBeLessThan(large.choix.length);
  });

  test('une dalle hors de la zone n’est pas lue', () => {
    const loin = dalleSynthetique('b.copc.laz', { ...e, centre: [660500, 6862500, 530] });
    const s = choisirNoeuds([dalle, loin], cx, cy, 460, 1e9);
    expect(s.choix.every((c) => c.url === 'a.copc.laz')).toBe(true);
  });
});

test('index des dalles : adresses en https, voisines hors emprise écartées', () => {
  const f = (nom: string, http = false): unknown => ({ properties: { url_npl: `${http ? 'http' : 'https'}://data.geopf.fr/telechargement/download/LiDARHD-NUALID/X/${nom}_PTS_LAMB93_IGN69.copc.laz` } });
  const json = { features: [f('LHD_FXX_0654_6863', true), f('LHD_FXX_0655_6863'), f('LHD_FXX_0652_6862'), f('LHD_FXX_0654_6863'), { properties: {} }] };
  const urls = lireIndexDalles(json, { x0: 654001, y0: 6862001, x1: 655999, y1: 6862999 });
  expect(urls).toEqual([
    'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/X/LHD_FXX_0654_6863_PTS_LAMB93_IGN69.copc.laz',
    'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/X/LHD_FXX_0655_6863_PTS_LAMB93_IGN69.copc.laz',
  ]);
});
