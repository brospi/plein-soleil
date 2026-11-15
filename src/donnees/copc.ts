/**
 * Lecture des nuages de points LiDAR HD de l'IGN, publiés en COPC
 * (LAZ organisé en octree, lisible par plages d'octets).
 *
 * Une dalle couvre 1 km². Son en-tête donne l'octree ; chaque nœud est un
 * bloc LAZ indépendant. Les niveaux s'additionnent : le nœud racine contient
 * un échantillon clairsemé de toute la dalle, chaque niveau suivant en ajoute
 * environ quatre fois plus sur des cases quatre fois plus petites.
 *
 * Format : https://copc.io
 */

/** Taille lue au début du fichier : en-tête LAS 1.4 (375 octets) et VLR d'information COPC (54 + 160). */
export const TAILLE_ENTETE = 589;

export interface EnteteCopc {
  formatPoint: number;
  longueurPoint: number;
  nombrePoints: number;
  echelle: [number, number, number];
  decalage: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  /** Cube de l'octree : centre et demi-côté (m). */
  centre: [number, number, number];
  demiCote: number;
  /** Espacement des points du nœud racine (m) ; il est divisé par deux à chaque niveau. */
  espacement: number;
  pageRacine: { position: number; taille: number };
}

export interface Noeud {
  /** Niveau et position dans l'octree. */
  d: number;
  x: number;
  y: number;
  z: number;
  position: number;
  taille: number;
  /** Nombre de points ; −1 désigne une page de hiérarchie à lire. */
  points: number;
}

function u64(v: DataView, o: number): number {
  return Number(v.getBigUint64(o, true));
}

export function lireEntete(octets: Uint8Array): EnteteCopc {
  if (octets.length < TAILLE_ENTETE) throw new Error('En-tête COPC incomplet');
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const signature = String.fromCharCode(octets[0], octets[1], octets[2], octets[3]);
  if (signature !== 'LASF') throw new Error('Ce fichier n’est pas un nuage de points LAS');
  const idVlr = String.fromCharCode(...octets.subarray(377, 381));
  if (idVlr !== 'copc' || v.getUint16(393, true) !== 1) throw new Error('Ce nuage de points n’est pas au format COPC');
  const d = (o: number): number => v.getFloat64(o, true);
  return {
    // Le bit 7 signale la compression LAZ, le bit 6 une ancienne convention.
    formatPoint: octets[104] & 0x3f,
    longueurPoint: v.getUint16(105, true),
    nombrePoints: u64(v, 247),
    echelle: [d(131), d(139), d(147)],
    decalage: [d(155), d(163), d(171)],
    max: [d(179), d(195), d(211)],
    min: [d(187), d(203), d(219)],
    centre: [d(429), d(437), d(445)],
    demiCote: d(453),
    espacement: d(461),
    pageRacine: { position: u64(v, 469), taille: u64(v, 477) },
  };
}

/** Entrées d'une page de hiérarchie (32 octets chacune). */
export function lireHierarchie(octets: Uint8Array): Noeud[] {
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const noeuds: Noeud[] = [];
  for (let o = 0; o + 32 <= octets.length; o += 32) {
    noeuds.push({
      d: v.getInt32(o, true),
      x: v.getInt32(o + 4, true),
      y: v.getInt32(o + 8, true),
      z: v.getInt32(o + 12, true),
      position: u64(v, o + 16),
      taille: v.getInt32(o + 24, true),
      points: v.getInt32(o + 28, true),
    });
  }
  return noeuds;
}

export function cleNoeud(n: Pick<Noeud, 'd' | 'x' | 'y' | 'z'>): string {
  return `${n.d}-${n.x}-${n.y}-${n.z}`;
}

/** Emprise horizontale d'un nœud (Lambert 93). */
export function empriseNoeud(e: EnteteCopc, n: Pick<Noeud, 'd' | 'x' | 'y'>): { x0: number; y0: number; x1: number; y1: number } {
  const cote = (2 * e.demiCote) / 2 ** n.d;
  const x0 = e.centre[0] - e.demiCote + n.x * cote;
  const y0 = e.centre[1] - e.demiCote + n.y * cote;
  return { x0, y0, x1: x0 + cote, y1: y0 + cote };
}

/** Le décodeur LAZ compilé en WebAssembly (laz-perf), réduit à ce qui sert ici. */
export interface DecodeurLaz {
  HEAPU8: Uint8Array;
  _malloc(n: number): number;
  _free(p: number): void;
  ChunkDecoder: new () => { open(format: number, longueur: number, pointeur: number): void; getPoint(pointeur: number): void; delete(): void };
}

/** Décompresse un bloc LAZ : enregistrements LAS bruts, `longueurPoint` octets par point. */
export function decompresser(laz: DecodeurLaz, bloc: Uint8Array, e: Pick<EnteteCopc, 'formatPoint' | 'longueurPoint'>, points: number): Uint8Array {
  const sortie = new Uint8Array(points * e.longueurPoint);
  const pBloc = laz._malloc(bloc.byteLength);
  const pPoint = laz._malloc(e.longueurPoint);
  const decodeur = new laz.ChunkDecoder();
  try {
    laz.HEAPU8.set(bloc, pBloc);
    decodeur.open(e.formatPoint, e.longueurPoint, pBloc);
    for (let i = 0; i < points; i++) {
      decodeur.getPoint(pPoint);
      // HEAPU8 peut changer si la mémoire du module grandit : on le relit à chaque point.
      sortie.set(laz.HEAPU8.subarray(pPoint, pPoint + e.longueurPoint), i * e.longueurPoint);
    }
  } finally {
    decodeur.delete();
    laz._free(pPoint);
    laz._free(pBloc);
  }
  return sortie;
}

/** Classes de la classification LiDAR HD de l'IGN. */
export const ClasseLas = {
  NonClasse: 1,
  Sol: 2,
  VegetationBasse: 3,
  VegetationMoyenne: 4,
  VegetationHaute: 5,
  Batiment: 6,
  Eau: 9,
  Pont: 17,
  Sursol: 64,
  Artefact: 65,
  Virtuel: 66,
  DiversBati: 67,
} as const;

export interface PointsBruts {
  /** X, Y, Z en mètres, relatifs à `origine` (X, Y) ; Z en altitude NGF. */
  xyz: Float32Array;
  classe: Uint8Array;
  intensite: Uint16Array;
  nombre: number;
}

/**
 * Coordonnées, classe et intensité des points (formats 6 à 10 : X, Y, Z,
 * intensité, retours, drapeaux, classe aux mêmes positions). Les points
 * marqués « retenus », les artefacts et les points virtuels sont écartés.
 */
export function extrairePoints(brut: Uint8Array, e: Pick<EnteteCopc, 'formatPoint' | 'longueurPoint' | 'echelle' | 'decalage'>, origine: { x: number; y: number }): PointsBruts {
  if (e.formatPoint < 6) throw new Error(`Format de point LAS ${e.formatPoint} non pris en charge`);
  const n = Math.floor(brut.length / e.longueurPoint);
  const v = new DataView(brut.buffer, brut.byteOffset, brut.byteLength);
  const xyz = new Float32Array(n * 3);
  const classe = new Uint8Array(n);
  const intensite = new Uint16Array(n);
  const [ex, ey, ez] = e.echelle;
  const ox = e.decalage[0] - origine.x;
  const oy = e.decalage[1] - origine.y;
  const oz = e.decalage[2];
  let k = 0;
  for (let i = 0, o = 0; i < n; i++, o += e.longueurPoint) {
    const c = brut[o + 16];
    // Octet 15 : synthétique, point clé, retenu, recouvrement (bits 0 à 3).
    const retenu = (brut[o + 15] & 0x04) !== 0;
    if (retenu || c === ClasseLas.Artefact || c === ClasseLas.Virtuel || c === 7 || c === 18) continue;
    xyz[k * 3] = v.getInt32(o, true) * ex + ox;
    xyz[k * 3 + 1] = v.getInt32(o + 4, true) * ey + oy;
    xyz[k * 3 + 2] = v.getInt32(o + 8, true) * ez + oz;
    classe[k] = c;
    intensite[k] = v.getUint16(o + 12, true);
    k++;
  }
  return { xyz: xyz.subarray(0, k * 3), classe: classe.subarray(0, k), intensite: intensite.subarray(0, k), nombre: k };
}
