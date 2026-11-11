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
 */
import { type Raster } from './raster';

const RAD = Math.PI / 180;
/** Courbure terrestre et réfraction (k = 0,13) : abaissement apparent en m par m² de distance. */
const COURBURE = (1 - 0.13) / (2 * 6_371_000);

export interface Niveau {
  dur: Raster;
  arbres: Raster | null;
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
  offArb: Int32Array;
  arb: Float32Array;
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
  envArb: Enveloppe | null,
  arbres: Raster | null,
): number {
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
  for (;;) {
    if (!premiere && t > 1e-3) {
      const i = cy * L + cx;
      const chute = t * t * COURBURE;
      env.ajouter(t, d[i] - chute);
      if (da && envArb) {
        const a = da[i];
        if (a > -1000) envArb.ajouter(t, a - chute);
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
  const offArb = new Int32Array(nk + 1);
  const ptsDur: number[] = [];
  const ptsArb: number[] = [];
  const env = new Enveloppe();
  const envArb = new Enveloppe();
  for (let j = 0; j < nk; j++) {
    const az = ((k0 + j) % nAz) * pasAz * RAD;
    const dx = Math.sin(az);
    const dy = Math.cos(az);
    env.vider();
    envArb.vider();
    let t = 0;
    for (let n = 0; n < niveaux.length && t < distanceMax; n++) {
      const niv = niveaux[n];
      t = parcourir(niv.dur, ox, oy, dx, dy, t, distanceMax, n === 0, env, envArb, niv.arbres);
    }
    for (let i = 0; i < env.n; i++) ptsDur.push(env.d[i], env.h[i]);
    for (let i = 0; i < envArb.n; i++) ptsArb.push(envArb.d[i], envArb.h[i]);
    offDur[j + 1] = ptsDur.length;
    offArb[j + 1] = ptsArb.length;
  }
  return { pasAz, nAz, k0, nk, offDur, dur: Float32Array.from(ptsDur), offArb, arb: Float32Array.from(ptsArb) };
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
 * Remplit, pour une altitude d'observation z, la tangente de l'angle
 * d'horizon de chaque azimut calculé (bâti dans `tanDur`, arbres dans `tanArb`).
 */
export function horizonPourAltitude(f: Faisceau, z: number, tanDur: Float32Array, tanArb: Float32Array): void {
  for (let j = 0; j < f.nk; j++) {
    tanDur[j] = tangenteMax(f.dur, f.offDur[j], f.offDur[j + 1], z);
    tanArb[j] = tangenteMax(f.arb, f.offArb[j], f.offArb[j + 1], z);
  }
}

/** Indice (dans la plage calculée) de l'azimut « grille » donné, ou −1 s'il est hors plage. */
export function indiceAzimut(f: Pick<Faisceau, 'pasAz' | 'nAz' | 'k0' | 'nk'>, azimutGrille: number): number {
  const k = ((Math.round(azimutGrille / f.pasAz) % f.nAz) + f.nAz) % f.nAz;
  const j = (k - f.k0 + f.nAz) % f.nAz;
  return j < f.nk ? j : -1;
}
