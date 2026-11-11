/**
 * Façades : arêtes des emprises BD TOPO, normale extérieure, détection des
 * murs mitoyens et placement du point d'observation à l'air libre.
 *
 * L'emprise cadastrale et le LiDAR sont souvent décalés de 1 à 2 m : la
 * position réelle du mur est donc relue sur le relief, étage par étage, le
 * long de la normale à l'arête.
 */
import { type Raster, valeur, valeurLisse, creerRaster } from './raster';

export interface Anneau {
  /** Coordonnées x, y alternées (Lambert 93), anneau fermé sans répétition du premier point. */
  pts: number[];
  trou: boolean;
}

export interface Batiment {
  id: string;
  anneaux: Anneau[];
  /** Hauteur BD TOPO (m), souvent absente. */
  hauteur: number | null;
  etages: number | null;
  usage: string | null;
}

export type StatutArete = 'libre' | 'mitoyen' | 'courte';

export interface Arete {
  /** Indice du bâtiment dans la scène. */
  bat: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Normale unitaire dirigée vers l'extérieur du bâtiment. */
  nx: number;
  ny: number;
  longueur: number;
  statut: StatutArete;
  /** Premier étage où le mur donne sur l'extérieur (0 = rez-de-chaussée). */
  etageMin: number;
  /** Nombre d'étages estimé au droit de l'arête. */
  nbEtages: number;
}

export interface Relief {
  /** Surface dure fine (bâti + sol, sans végétation). */
  dur: Raster;
  /** Terrain nu. */
  mnt: Raster;
}

export interface ParametresEtages {
  /** Hauteur d'un étage, plancher à plancher (m). */
  hauteurEtage: number;
  /** Hauteur du centre de la fenêtre au-dessus du plancher (m). */
  hauteurCentre: number;
}

export const ETAGES_DEFAUT: ParametresEtages = { hauteurEtage: 3, hauteurCentre: 1.7 };

/* ------------------------------------------------------------------ */
/* Géométrie des emprises                                              */
/* ------------------------------------------------------------------ */

function aireSignee(pts: number[]): number {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1];
  }
  return a / 2;
}

/** Convertit une géométrie GeoJSON (Polygon ou MultiPolygon) en anneaux. */
export function anneauxDepuisGeoJSON(geometrie: { type: string; coordinates: unknown }): Anneau[] {
  const polygones =
    geometrie.type === 'MultiPolygon'
      ? (geometrie.coordinates as number[][][][])
      : geometrie.type === 'Polygon'
        ? [geometrie.coordinates as number[][][]]
        : [];
  const anneaux: Anneau[] = [];
  for (const poly of polygones) {
    poly.forEach((ring, idx) => {
      const pts: number[] = [];
      const n = ring.length;
      // Le dernier point répète le premier dans GeoJSON.
      const fin = n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? n - 1 : n;
      for (let i = 0; i < fin; i++) pts.push(ring[i][0], ring[i][1]);
      if (pts.length >= 6) anneaux.push({ pts, trou: idx > 0 });
    });
  }
  return anneaux;
}

/** Test point-dans-bâtiment (règle pair-impair, trous compris). */
export function contient(b: Batiment, x: number, y: number): boolean {
  let dedans = false;
  for (const a of b.anneaux) {
    const p = a.pts;
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[2 * i];
      const yi = p[2 * i + 1];
      const xj = p[2 * j];
      const yj = p[2 * j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
    }
  }
  return dedans;
}

/** Arêtes d'un bâtiment avec leur normale extérieure (statut non encore évalué). */
export function aretesDuBatiment(b: Batiment, indice: number): Arete[] {
  const aretes: Arete[] = [];
  for (const anneau of b.anneaux) {
    const p = anneau.pts;
    const n = p.length / 2;
    // Anneau extérieur antihoraire : l'intérieur est à gauche, la normale sortante à droite.
    const sens = (aireSignee(p) > 0 ? 1 : -1) * (anneau.trou ? -1 : 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[2 * i];
      const ay = p[2 * i + 1];
      const bx = p[2 * j];
      const by = p[2 * j + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const longueur = Math.hypot(dx, dy);
      if (longueur < 0.05) continue;
      aretes.push({
        bat: indice,
        ax,
        ay,
        bx,
        by,
        nx: (sens * dy) / longueur,
        ny: (-sens * dx) / longueur,
        longueur,
        statut: longueur < 1.2 ? 'courte' : 'libre',
        etageMin: 0,
        nbEtages: 0,
      });
    }
  }
  return aretes;
}

/** Azimut « grille » (degrés, 0 = nord, sens horaire) d'un vecteur. */
export function azimutDe(nx: number, ny: number): number {
  return ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
}

/** Projection d'un point sur une arête : abscisse curviligne bornée, point projeté et distance. */
export function projeterSurArete(a: Arete, x: number, y: number): { t: number; x: number; y: number; distance: number } {
  const dx = a.bx - a.ax;
  const dy = a.by - a.ay;
  let t = ((x - a.ax) * dx + (y - a.ay) * dy) / (a.longueur * a.longueur);
  t = Math.max(0, Math.min(1, t));
  const px = a.ax + t * dx;
  const py = a.ay + t * dy;
  return { t, x: px, y: py, distance: Math.hypot(x - px, y - py) };
}

/** Arête la plus proche d'un point, parmi celles qui satisfont `filtre`. */
export function areteLaPlusProche(
  aretes: Arete[],
  x: number,
  y: number,
  distanceMax: number,
  filtre: (a: Arete) => boolean = () => true,
): { arete: Arete; indice: number; x: number; y: number; distance: number } | null {
  let meilleur: { arete: Arete; indice: number; x: number; y: number; distance: number } | null = null;
  for (let i = 0; i < aretes.length; i++) {
    const a = aretes[i];
    if (!filtre(a)) continue;
    const p = projeterSurArete(a, x, y);
    if (p.distance <= distanceMax && (!meilleur || p.distance < meilleur.distance)) {
      meilleur = { arete: a, indice: i, x: p.x, y: p.y, distance: p.distance };
    }
  }
  return meilleur;
}

/* ------------------------------------------------------------------ */
/* Lecture du mur sur le relief                                        */
/* ------------------------------------------------------------------ */

const S_MIN = -6;
const S_PAS = 0.25;
const N_PROFIL = 49; // de −6 m à +6 m
const S_MAX_MUR = 3; // au-delà, le « mur » trouvé n'est plus celui de l'arête

/** Altitudes de la surface dure le long de la normale, de 6 m à l'intérieur à 6 m à l'extérieur. */
export function profilNormal(dur: Raster, px: number, py: number, nx: number, ny: number, sortie = new Float32Array(N_PROFIL)): Float32Array {
  for (let i = 0; i < N_PROFIL; i++) {
    const s = S_MIN + i * S_PAS;
    sortie[i] = valeur(dur, px + nx * s, py + ny * s, -9999);
  }
  return sortie;
}

/**
 * Position du mur à l'altitude z le long d'un profil : abscisse (m, par
 * rapport à l'arête cadastrale) de la transition plein → vide la plus proche
 * de l'arête. Renvoie null si l'altitude est au-dessus du toit ou si
 * l'extérieur est couvert (mitoyenneté, volume accolé).
 */
export function positionDuMur(profil: Float32Array, z: number): number | null {
  const seuil = z - 0.5; // la surface doit passer sous l'appui de la fenêtre
  let meilleur: number | null = null;
  for (let i = 1; i < N_PROFIL - 1; i++) {
    const s = S_MIN + (i - 0.5) * S_PAS;
    if (s > S_MAX_MUR) break;
    if (profil[i - 1] > seuil && profil[i] <= seuil && profil[i] > -1000) {
      // Il faut au moins 0,75 m de vide devant le mur.
      const i2 = Math.min(N_PROFIL - 1, i + 2);
      if (profil[i + 1] > seuil || profil[i2] > seuil) continue;
      if (meilleur === null || Math.abs(s) < Math.abs(meilleur)) meilleur = s;
    }
  }
  return meilleur;
}

export interface EtageAnalyse {
  etage: number;
  /** Altitude du centre de la fenêtre (m NGF). */
  z: number;
  /** Décalage du mur réel par rapport à l'arête (m), ou null si l'étage ne donne pas sur l'extérieur. */
  decalage: number | null;
}

export interface AnalysePoint {
  /** Altitude du sol au pied de la façade (m NGF). */
  sol: number;
  /** Altitude du toit au droit du point (m NGF). */
  toit: number;
  etages: EtageAnalyse[];
  /** Premier étage valide, ou −1. */
  etageMin: number;
}

const DECALAGES_LATERAUX = [0, -0.6, 0.6];
const tampons = DECALAGES_LATERAUX.map(() => new Float32Array(N_PROFIL));

/** Décalage du mur à l'altitude z au droit d'un point d'arête (trois profils parallèles). */
export function decalageDuMur(relief: Relief, px: number, py: number, nx: number, ny: number, z: number, profilsPrets = false): number | null {
  const tx = ny; // tangente à la façade
  const ty = -nx;
  let d: number | null = null;
  for (let k = 0; k < DECALAGES_LATERAUX.length; k++) {
    const o = DECALAGES_LATERAUX[k];
    if (!profilsPrets) profilNormal(relief.dur, px + tx * o, py + ty * o, nx, ny, tampons[k]);
    const dk = positionDuMur(tampons[k], z);
    if (k === 0) {
      if (dk === null) return null;
      d = dk;
    } else if (dk !== null && dk > d! && dk - d! < 1.5) {
      d = dk;
    }
  }
  return d;
}

/** Analyse verticale de la façade au droit d'un point d'arête. */
export function analyserPoint(relief: Relief, px: number, py: number, nx: number, ny: number, p: ParametresEtages = ETAGES_DEFAUT): AnalysePoint {
  const tx = ny;
  const ty = -nx;
  DECALAGES_LATERAUX.forEach((o, k) => profilNormal(relief.dur, px + tx * o, py + ty * o, nx, ny, tampons[k]));
  // Toit : 85e centile de la bande intérieure (−5 m à 0).
  const interieur: number[] = [];
  for (let i = 0; i < N_PROFIL; i++) {
    const s = S_MIN + i * S_PAS;
    if (s >= -5 && s <= 0 && tampons[0][i] > -1000) interieur.push(tampons[0][i]);
  }
  interieur.sort((a, b) => a - b);
  const toit = interieur.length ? interieur[Math.min(interieur.length - 1, Math.floor(interieur.length * 0.85))] : -9999;
  let sol = valeurLisse(relief.mnt, px + nx * 1.5, py + ny * 1.5, -9999);
  if (!(sol > -1000)) sol = valeurLisse(relief.mnt, px, py, 0);
  const etages: EtageAnalyse[] = [];
  let etageMin = -1;
  const nb = Math.max(0, Math.floor((toit - 0.6 - sol - p.hauteurCentre) / p.hauteurEtage) + 1);
  for (let k = 0; k < Math.min(nb, 60); k++) {
    const z = sol + k * p.hauteurEtage + p.hauteurCentre;
    const decalage = decalageDuMur(relief, px, py, nx, ny, z, true);
    if (decalage !== null && etageMin < 0) etageMin = k;
    etages.push({ etage: k, z, decalage });
  }
  return { sol, toit, etages, etageMin };
}

/**
 * Évalue chaque arête : « libre » si au moins un étage donne sur l'extérieur
 * quelque part le long du mur, « mitoyen » sinon.
 */
export function classerAretes(aretes: Arete[], relief: Relief, p: ParametresEtages = ETAGES_DEFAUT): void {
  for (const a of aretes) {
    if (a.statut === 'courte') continue;
    const n = Math.max(1, Math.min(8, Math.round(a.longueur / 2.5)));
    let etageMin = -1;
    let nbEtages = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const an = analyserPoint(relief, a.ax + (a.bx - a.ax) * t, a.ay + (a.by - a.ay) * t, a.nx, a.ny, p);
      if (an.etages.length > nbEtages) nbEtages = an.etages.length;
      if (an.etageMin >= 0 && (etageMin < 0 || an.etageMin < etageMin)) etageMin = an.etageMin;
    }
    a.nbEtages = nbEtages;
    if (etageMin < 0) {
      a.statut = 'mitoyen';
      a.etageMin = -1;
    } else {
      a.statut = 'libre';
      a.etageMin = etageMin;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Repli sans LiDAR : relief synthétique à partir des hauteurs BD TOPO  */
/* ------------------------------------------------------------------ */

/** Hauteur à retenir pour un bâtiment sans LiDAR (m), et indication de fiabilité. */
export function hauteurEstimee(b: Batiment, defaut = 9): { hauteur: number; fiable: boolean } {
  if (b.hauteur && b.hauteur > 0) return { hauteur: b.hauteur, fiable: true };
  if (b.etages && b.etages > 0) return { hauteur: b.etages * 3, fiable: false };
  return { hauteur: defaut, fiable: false };
}

/** Extrude les emprises sur le terrain : MNS synthétique pour les zones sans LiDAR HD. */
export function extruderBatiments(sol: Raster, batiments: Batiment[]): Raster {
  const r = creerRaster(sol.x0, sol.y1, sol.pas, sol.largeur, sol.hauteur);
  r.d.set(sol.d);
  const croisements: number[] = [];
  for (const b of batiments) {
    const { hauteur } = hauteurEstimee(b);
    let yMin = Infinity;
    let yMax = -Infinity;
    let base = Infinity;
    for (const a of b.anneaux) {
      for (let i = 1; i < a.pts.length; i += 2) {
        yMin = Math.min(yMin, a.pts[i]);
        yMax = Math.max(yMax, a.pts[i]);
        const s = valeurLisse(sol, a.pts[i - 1], a.pts[i], Infinity);
        if (s < base) base = s;
      }
    }
    if (!Number.isFinite(base)) continue;
    const l0 = Math.max(0, Math.floor((r.y1 - yMax) / r.pas));
    const l1 = Math.min(r.hauteur - 1, Math.floor((r.y1 - yMin) / r.pas));
    for (let l = l0; l <= l1; l++) {
      const y = r.y1 - (l + 0.5) * r.pas;
      croisements.length = 0;
      for (const a of b.anneaux) {
        const p = a.pts;
        const n = p.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const yi = p[2 * i + 1];
          const yj = p[2 * j + 1];
          if (yi > y !== yj > y) croisements.push(p[2 * i] + ((y - yi) / (yj - yi)) * (p[2 * j] - p[2 * i]));
        }
      }
      croisements.sort((a, b2) => a - b2);
      for (let k = 0; k + 1 < croisements.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((croisements[k] - r.x0) / r.pas - 0.5));
        const c1 = Math.min(r.largeur - 1, Math.floor((croisements[k + 1] - r.x0) / r.pas - 0.5));
        for (let c = c0; c <= c1; c++) {
          const i = l * r.largeur + c;
          const z = base + hauteur;
          if (z > r.d[i]) r.d[i] = z;
        }
      }
    }
  }
  return r;
}
