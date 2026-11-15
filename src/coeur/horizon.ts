/**
 * Masque d'horizon par lancer de rayons sur un relief multi-résolution.
 *
 * Pour chaque azimut, le rayon traverse les cellules du raster (parcours de
 * grille exact, type Amanatides-Woo) du niveau le plus fin au plus grossier.
 * Chaque cellule est une colonne à toit plat ; on n'en retient que
 * l'enveloppe convexe supérieure du profil (distance, altitude). Cette
 * enveloppe suffit pour retrouver l'angle d'horizon depuis n'importe quelle
 * hauteur d'observation sur la même verticale : changer d'étage ne relance
 * donc aucun rayon.
 *
 * Arbres : à moins de `DISTANCE_HOUPPIERS`, un houppier dont la base est
 * connue laisse passer le soleil en dessous. On garde alors, en plus du
 * sommet, l'enveloppe convexe *inférieure* des bases : l'angle le plus bas
 * sous lequel commence un houppier proche. Entre cet angle et le sommet de la
 * végétation qui touche le sol (ou lointaine), le soleil passe sous les arbres.
 */
import { type Raster } from './raster';

const RAD = Math.PI / 180;
/** Courbure terrestre et réfraction (k = 0,13) : abaissement apparent en m par m² de distance. */
const COURBURE = (1 - 0.13) / (2 * 6_371_000);
/** Distance (m) jusqu'à laquelle on tient compte du vide sous les houppiers ; au-delà, il ne passe plus qu'un soleil rasant. */
export const DISTANCE_HOUPPIERS = 60;

export interface Niveau {
  dur: Raster;
  /** Sommet de toute la végétation. */
  arbres: Raster | null;
  /** Sommet des seuls arbres à feuillage persistant, quand un inventaire les identifie. */
  persistants?: Raster | null;
  /** Base des houppiers (SANS_DONNEE : végétation jusqu'au sol). */
  bases?: Raster | null;
}

/** Enveloppes d'une catégorie de végétation, pour l'azimut k : points [off[k], off[k+1][ (paires distance, altitude). */
export interface EnveloppesArbres {
  /** Sommets de la végétation qui descend jusqu'au sol, ou lointaine. */
  offBas: Int32Array;
  bas: Float32Array;
  /** Sommets des houppiers proches à base connue. */
  offHaut: Int32Array;
  haut: Float32Array;
  /** Bases de ces houppiers, altitudes changées de signe (enveloppe inférieure). */
  offBase: Int32Array;
  base: Float32Array;
}

export interface Faisceau {
  /** Pas angulaire (degrés) et nombre d'azimuts sur 360°. */
  pasAz: number;
  nAz: number;
  /** Premier indice d'azimut calculé et nombre d'azimuts (plage circulaire). */
  k0: number;
  nk: number;
  /** Enveloppes : pour l'azimut k, points [offDur[k], offDur[k+1][ de `dur` (paires distance, altitude). */
  offDur: Int32Array;
  dur: Float32Array;
  /** Toute la végétation. */
  arbres: EnveloppesArbres;
  /** Arbres persistants (vides sans inventaire). */
  persistants: EnveloppesArbres;
}

export interface OptionsFaisceau {
  pasAz?: number;
  /** Demi-ouverture autour de la normale (degrés). 180 = tour d'horizon complet. */
  demiOuverture?: number;
  distanceMax?: number;
}

class Enveloppe {
  d: number[] = [];
  h: number[] = [];
  n = 0;
  vider(): void {
    this.n = 0;
  }
  ajouter(d: number, h: number): void {
    const xs = this.d;
    const hs = this.h;
    let n = this.n;
    while (n >= 2) {
      const x1 = xs[n - 2];
      const y1 = hs[n - 2];
      if ((hs[n - 1] - y1) * (d - x1) <= (h - y1) * (xs[n - 1] - x1)) n--;
      else break;
    }
    xs[n] = d;
    hs[n] = h;
    this.n = n + 1;
  }
}

const SANS_BASE = -1e9;

/** Enveloppes d'une catégorie de végétation le long d'un rayon. */
class CollecteArbres {
  bas = new Enveloppe();
  haut = new Enveloppe();
  base = new Enveloppe();
  vider(): void {
    this.bas.vider();
    this.haut.vider();
    this.base.vider();
  }
  ajouter(t: number, sommet: number, base: number): void {
    if (base > -1000) {
      this.haut.ajouter(t, sommet);
      this.base.ajouter(t, -base);
    } else this.bas.ajouter(t, sommet);
  }
}

class PointsArbres {
  bas: number[] = [];
  haut: number[] = [];
  base: number[] = [];
  offBas: Int32Array;
  offHaut: Int32Array;
  offBase: Int32Array;
  constructor(nk: number) {
    this.offBas = new Int32Array(nk + 1);
    this.offHaut = new Int32Array(nk + 1);
    this.offBase = new Int32Array(nk + 1);
  }
  ajouter(j: number, c: CollecteArbres): void {
    const copier = (e: Enveloppe, v: number[]): void => {
      for (let i = 0; i < e.n; i++) v.push(e.d[i], e.h[i]);
    };
    copier(c.bas, this.bas);
    copier(c.haut, this.haut);
    copier(c.base, this.base);
    this.offBas[j + 1] = this.bas.length;
    this.offHaut[j + 1] = this.haut.length;
    this.offBase[j + 1] = this.base.length;
  }
  fin(): EnveloppesArbres {
    return {
      offBas: this.offBas,
      bas: Float32Array.from(this.bas),
      offHaut: this.offHaut,
      haut: Float32Array.from(this.haut),
      offBase: this.offBase,
      base: Float32Array.from(this.base),
    };
  }
}

/**
 * Parcourt les cellules de `r` traversées par le rayon entre les distances
 * t0 et t1. Renvoie la distance de sortie du raster (ou t1).
 * `sauterPremiere` ignore la cellule de départ.
 */
function parcourir(
  r: Raster,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  t0: number,
  t1: number,
  sauterPremiere: boolean,
  env: Enveloppe,
  niveau: Niveau,
  envArb: CollecteArbres,
  envPers: CollecteArbres,
): number {
  const arbres = niveau.arbres;
  const persistants = niveau.persistants ?? null;
  const bases = niveau.bases ?? null;
  const inv = 1 / r.pas;
  const gx = (ox + dx * t0 - r.x0) * inv;
  const gy = (r.y1 - (oy + dy * t0)) * inv;
  let cx = Math.floor(gx);
  let cy = Math.floor(gy);
  const L = r.largeur;
  const H = r.hauteur;
  if (cx < 0 || cy < 0 || cx >= L || cy >= H) return t0;
  const pasX = dx > 0 ? 1 : -1;
  const pasY = dy > 0 ? -1 : 1; // les lignes croissent vers le sud
  const tDeltaX = dx !== 0 ? r.pas / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? r.pas / Math.abs(dy) : Infinity;
  let tMaxX = dx !== 0 ? t0 + ((dx > 0 ? cx + 1 - gx : gx - cx) * r.pas) / Math.abs(dx) : Infinity;
  let tMaxY = dy !== 0 ? t0 + ((dy > 0 ? gy - cy : cy + 1 - gy) * r.pas) / Math.abs(dy) : Infinity;
  let t = t0;
  let premiere = sauterPremiere;
  const d = r.d;
  const da = arbres ? arbres.d : null;
  const dp = persistants ? persistants.d : null;
  const db = bases ? bases.d : null;
  for (;;) {
    if (!premiere && t > 1e-3) {
      const i = cy * L + cx;
      const chute = t * t * COURBURE;
      env.ajouter(t, d[i] - chute);
      // Base du houppier, si elle est connue et assez proche pour compter.
      const b = db && t <= DISTANCE_HOUPPIERS ? db[i] : SANS_BASE;
      if (da) {
        const a = da[i];
        if (a > -1000) envArb.ajouter(t, a - chute, b - chute);
      }
      if (dp) {
        const a = dp[i];
        if (a > -1000) envPers.ajouter(t, a - chute, b - chute);
      }
    }
    premiere = false;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      cx += pasX;
      if (cx < 0 || cx >= L) return t;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      cy += pasY;
      if (cy < 0 || cy >= H) return t;
    }
    if (t >= t1) return t1;
  }
}

/** Calcule les enveloppes d'horizon autour d'une origine (coordonnées Lambert 93). */
export function calculerFaisceau(
  niveaux: Niveau[],
  ox: number,
  oy: number,
  azNormale: number,
  options: OptionsFaisceau = {},
): Faisceau {
  const pasAz = options.pasAz ?? 0.25;
  const demi = options.demiOuverture ?? 90.5;
  const distanceMax = options.distanceMax ?? 6000;
  const nAz = Math.round(360 / pasAz);
  let k0: number;
  let nk: number;
  if (demi >= 180) {
    k0 = 0;
    nk = nAz;
  } else {
    k0 = ((Math.ceil((azNormale - demi) / pasAz) % nAz) + nAz) % nAz;
    nk = Math.floor((2 * demi) / pasAz) + 1;
  }
  const offDur = new Int32Array(nk + 1);
  const ptsDur: number[] = [];
  const ptsArb = new PointsArbres(nk);
  const ptsPers = new PointsArbres(nk);
  const env = new Enveloppe();
  const envArb = new CollecteArbres();
  const envPers = new CollecteArbres();
  for (let j = 0; j < nk; j++) {
    const az = ((k0 + j) % nAz) * pasAz * RAD;
    const dx = Math.sin(az);
    const dy = Math.cos(az);
    env.vider();
    envArb.vider();
    envPers.vider();
    let t = 0;
    for (let n = 0; n < niveaux.length && t < distanceMax; n++) {
      const niv = niveaux[n];
      t = parcourir(niv.dur, ox, oy, dx, dy, t, distanceMax, n === 0, env, niv, envArb, envPers);
    }
    for (let i = 0; i < env.n; i++) ptsDur.push(env.d[i], env.h[i]);
    offDur[j + 1] = ptsDur.length;
    ptsArb.ajouter(j, envArb);
    ptsPers.ajouter(j, envPers);
  }
  return { pasAz, nAz, k0, nk, offDur, dur: Float32Array.from(ptsDur), arbres: ptsArb.fin(), persistants: ptsPers.fin() };
}

/** Tangente de l'angle d'horizon maximal d'une enveloppe vue depuis l'altitude z. */
function tangenteMax(pts: Float32Array, debut: number, fin: number, z: number): number {
  let m = -Infinity;
  for (let i = debut; i < fin; i += 2) {
    const t = (pts[i + 1] - z) / pts[i];
    if (t > m) m = t;
  }
  return m;
}

/**
 * Masque d'une catégorie d'arbres pour un azimut : le soleil de tangente t
 * est caché si t ≤ `bas`, ou si `houppier` ≤ t ≤ `sommet` (entre les deux, il
 * passe sous les houppiers proches).
 */
export interface MasqueArbres {
  /** Sommet de toute la végétation. */
  sommet: Float32Array;
  /** Sommet de la végétation qui descend jusqu'au sol, ou lointaine. */
  bas: Float32Array;
  /** Angle le plus bas où commence un houppier proche (+∞ s'il n'y en a pas). */
  houppier: Float32Array;
}

export function creerMasque(nk: number): MasqueArbres {
  return { sommet: new Float32Array(nk), bas: new Float32Array(nk), houppier: new Float32Array(nk) };
}

/** Vrai si un soleil de tangente t est caché par cette catégorie d'arbres. */
export function cacheParArbres(m: MasqueArbres, j: number, t: number): boolean {
  return t <= m.bas[j] || (t >= m.houppier[j] && t <= m.sommet[j]);
}

function remplirMasque(e: EnveloppesArbres, j: number, z: number, m: MasqueArbres): void {
  const bas = tangenteMax(e.bas, e.offBas[j], e.offBas[j + 1], z);
  const haut = tangenteMax(e.haut, e.offHaut[j], e.offHaut[j + 1], z);
  m.bas[j] = bas;
  m.sommet[j] = Math.max(bas, haut);
  // min des pentes vers les bases = −max des pentes vers les bases changées de signe.
  m.houppier[j] = -tangenteMax(e.base, e.offBase[j], e.offBase[j + 1], -z);
}

/**
 * Remplit, pour une altitude d'observation z, la tangente de l'angle
 * d'horizon bâti de chaque azimut calculé, et les masques des arbres.
 */
export function horizonPourAltitude(f: Faisceau, z: number, tanDur: Float32Array, arbres: MasqueArbres, persistants?: MasqueArbres): void {
  for (let j = 0; j < f.nk; j++) {
    tanDur[j] = tangenteMax(f.dur, f.offDur[j], f.offDur[j + 1], z);
    remplirMasque(f.arbres, j, z, arbres);
    if (persistants) remplirMasque(f.persistants, j, z, persistants);
  }
}

/** Indice (dans la plage calculée) de l'azimut « grille » donné, ou −1 s'il est hors plage. */
export function indiceAzimut(f: Pick<Faisceau, 'pasAz' | 'nAz' | 'k0' | 'nk'>, azimutGrille: number): number {
  const k = ((Math.round(azimutGrille / f.pasAz) % f.nAz) + f.nAz) % f.nAz;
  const j = (k - f.k0 + f.nAz) % f.nAz;
  return j < f.nk ? j : -1;
}
