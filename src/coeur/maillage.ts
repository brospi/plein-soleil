/**
 * Maillage 3D d'un modèle de surface : pentes continues là où le relief est
 * lisse (sol, toits inclinés, houppiers), murs strictement verticaux là où il
 * est discontinu (façades). Un carré entre quatre échantillons dont le
 * dénivelé dépasse le seuil est découpé en quatre quarts à hauteur constante,
 * reliés par des murs verticaux : aucune pente parasite entre deux pixels.
 */
import { Classe } from './classification';

export interface Maillage {
  /** x (est), y (altitude relative), z (sud) en mètres. */
  positions: Float32Array;
  normales: Int8Array;
  couleurs: Uint8Array;
  indicesToits: Uint32Array;
  indicesMurs: Uint32Array;
}

class Tampon<T extends Float32Array | Int8Array | Uint8Array | Uint32Array> {
  n = 0;
  constructor(
    public t: T,
    private creer: (taille: number) => T,
  ) {}
  reserver(k: number): void {
    if (this.n + k > this.t.length) {
      const plus = this.creer(Math.max(this.t.length * 2, this.n + k));
      plus.set(this.t as never);
      this.t = plus;
    }
  }
  fin(): T {
    return this.t.slice(0, this.n) as T;
  }
}

type RVB = [number, number, number];

const COULEUR_TOIT: RVB = [168, 172, 181];
const COULEUR_MUR: RVB = [222, 211, 190];
const COULEUR_SOL: RVB = [158, 156, 150];
const COULEUR_HERBE: RVB = [137, 165, 104];
const COULEUR_ARBRE: RVB = [72, 122, 62];
const COULEUR_TRONC: RVB = [58, 98, 52];
const COULEUR_EAU: RVB = [112, 148, 176];
const COULEUR_PONT: RVB = [150, 150, 152];
const COULEUR_SURSOL: RVB = [178, 172, 162];

function couleurDessus(classe: number): RVB {
  switch (classe) {
    case Classe.Batiment:
      return COULEUR_TOIT;
    case Classe.Vegetation:
      return COULEUR_ARBRE;
    case Classe.VegetationBasse:
      return COULEUR_HERBE;
    case Classe.Eau:
      return COULEUR_EAU;
    case Classe.Pont:
      return COULEUR_PONT;
    case Classe.Sursol:
      return COULEUR_SURSOL;
    default:
      return COULEUR_SOL;
  }
}

function couleurMur(classe: number): RVB {
  if (classe === Classe.Vegetation) return COULEUR_TRONC;
  if (classe === Classe.Batiment || classe === Classe.Sursol) return COULEUR_MUR;
  return COULEUR_PONT;
}

/** Variation pseudo-aléatoire stable (±1) pour animer les aplats. */
function bruit(c: number, l: number): number {
  let h = (c * 374761393 + l * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

export interface OptionsMaillage {
  /** Dénivelé (m) au-delà duquel deux échantillons voisins sont séparés par un mur. */
  seuil: number;
  /** Abscisse (est) et ordonnée (sud) du centre de la cellule (0, 0), en mètres dans le repère de la vue. */
  ox: number;
  oz: number;
  /** Altitude retranchée à toutes les hauteurs. */
  z0: number;
  /** Rectangle de cellules à ne pas mailler (couvert par un maillage plus fin). */
  exclure?: { c0: number; c1: number; l0: number; l1: number };
}

/**
 * @param h altitudes aux centres des cellules, [ligne × largeur], ligne 0 au nord
 * @param classes classe de chaque cellule (ou null : tout en « sol »/« bâtiment » selon la hauteur)
 */
export function maillerRelief(h: Float32Array, classes: Uint8Array | null, largeur: number, hauteur: number, pas: number, o: OptionsMaillage): Maillage {
  const n = largeur * hauteur;
  const pos = new Tampon(new Float32Array(n * 3 + 3000), (k) => new Float32Array(k));
  const nor = new Tampon(new Int8Array(n * 3 + 3000), (k) => new Int8Array(k));
  const col = new Tampon(new Uint8Array(n * 3 + 3000), (k) => new Uint8Array(k));
  const iToits = new Tampon(new Uint32Array(n * 6), (k) => new Uint32Array(k));
  const iMurs = new Tampon(new Uint32Array(n), (k) => new Uint32Array(k));
  const { seuil, ox, oz, z0 } = o;

  const sommet = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: RVB, v: number): number => {
    pos.reserver(3);
    nor.reserver(3);
    col.reserver(3);
    const i = pos.n / 3;
    pos.t[pos.n++] = x;
    pos.t[pos.n++] = y;
    pos.t[pos.n++] = z;
    nor.t[nor.n++] = Math.round(nx * 127);
    nor.t[nor.n++] = Math.round(ny * 127);
    nor.t[nor.n++] = Math.round(nz * 127);
    const k = 1 + v * 0.06;
    col.t[col.n++] = Math.max(0, Math.min(255, c[0] * k));
    col.t[col.n++] = Math.max(0, Math.min(255, c[1] * k));
    col.t[col.n++] = Math.max(0, Math.min(255, c[2] * k));
    return i;
  };

  // 1. Un sommet par échantillon, normale issue du gradient local (différences bornées par le seuil).
  for (let l = 0; l < hauteur; l++) {
    for (let c = 0; c < largeur; c++) {
      const i = l * largeur + c;
      const z = h[i];
      const d = (j: number): number => {
        const dz = h[j] - z;
        return Math.abs(dz) > seuil ? 0 : dz;
      };
      const gx = ((c + 1 < largeur ? d(i + 1) : 0) - (c > 0 ? d(i - 1) : 0)) / (2 * pas);
      const gz = ((l + 1 < hauteur ? d(i + largeur) : 0) - (l > 0 ? d(i - largeur) : 0)) / (2 * pas);
      const norme = Math.hypot(gx, 1, gz);
      const cl = classes ? classes[i] : Classe.Sol;
      const v = cl === Classe.Vegetation ? bruit(c, l) * 2.2 + Math.min(2, (z - z0) / 25) : bruit(c, l);
      sommet(ox + c * pas, z - z0, oz + l * pas, -gx / norme, 1 / norme, -gz / norme, couleurDessus(cl), v);
    }
  }

  const triangle = (t: Tampon<Uint32Array>, a: number, b: number, c: number): void => {
    t.reserver(3);
    t.t[t.n++] = a;
    t.t[t.n++] = b;
    t.t[t.n++] = c;
  };

  // Mur vertical entre deux quarts, le long du segment (x1,z1)-(x2,z2).
  // (h1a, h2a) : hauteurs côté a aux deux extrémités ; (h1b, h2b) : côté b. La normale va du côté haut vers le côté bas.
  const mur = (x1: number, z1: number, x2: number, z2: number, h1a: number, h2a: number, h1b: number, h2b: number, nax: number, naz: number, clA: number, clB: number): void => {
    if (Math.abs(h1a - h1b) < 1e-3 && Math.abs(h2a - h2b) < 1e-3) return;
    const aHaut = h1a + h2a > h1b + h2b;
    // (nax, naz) pointe de a vers b.
    const nx = aHaut ? nax : -nax;
    const nz = aHaut ? naz : -naz;
    const c = couleurMur(aHaut ? clA : clB);
    const v = bruit(Math.round(x1 * 7), Math.round(z1 * 7)) * 0.6;
    const p1 = sommet(x1, h1a - z0, z1, nx, 0, nz, c, v);
    const p2 = sommet(x2, h2a - z0, z2, nx, 0, nz, c, v);
    const p3 = sommet(x2, h2b - z0, z2, nx, 0, nz, c, v - 1.5);
    const p4 = sommet(x1, h1b - z0, z1, nx, 0, nz, c, v - 1.5);
    // Orientation : face avant du côté de la normale.
    const ex = x2 - x1;
    const ez = z2 - z1;
    // (p2 − p1) × (p4 − p1), composantes horizontales : (−ez·dy, ex·dy) avec dy = h1b − h1a.
    const dy = h1b - h1a || h2b - h2a;
    const avant = -ez * dy * nx + ex * dy * nz > 0;
    if (avant) {
      triangle(iMurs, p1, p2, p4);
      triangle(iMurs, p2, p3, p4);
    } else {
      triangle(iMurs, p1, p4, p2);
      triangle(iMurs, p2, p4, p3);
    }
  };

  const ex = o.exclure;
  for (let l = 0; l + 1 < hauteur; l++) {
    for (let c = 0; c + 1 < largeur; c++) {
      if (ex && c >= ex.c0 && c < ex.c1 && l >= ex.l0 && l < ex.l1) continue;
      const iA = l * largeur + c;
      const iB = iA + 1;
      const iC = iA + largeur;
      const iD = iC + 1;
      const hA = h[iA];
      const hB = h[iB];
      const hC = h[iC];
      const hD = h[iD];
      const min = Math.min(hA, hB, hC, hD);
      const max = Math.max(hA, hB, hC, hD);
      if (max - min <= seuil) {
        triangle(iToits, iA, iC, iB);
        triangle(iToits, iB, iC, iD);
        continue;
      }
      // Carré discontinu : quatre quarts + murs.
      const x0 = ox + c * pas;
      const z0q = oz + l * pas;
      const xm = x0 + pas / 2;
      const zm = z0q + pas / 2;
      const x1 = x0 + pas;
      const z1 = z0q + pas;
      const mi = (a: number, b: number): number => (Math.abs(a - b) < seuil ? (a + b) / 2 : a);
      const clA = classes ? classes[iA] : Classe.Batiment;
      const clB = classes ? classes[iB] : Classe.Batiment;
      const clC = classes ? classes[iC] : Classe.Batiment;
      const clD = classes ? classes[iD] : Classe.Batiment;
      // Hauteurs aux milieux des côtés, vues de chaque coin.
      const nA = mi(hA, hB);
      const nB = mi(hB, hA);
      const wA = mi(hA, hC);
      const wC = mi(hC, hA);
      const eB = mi(hB, hD);
      const eD = mi(hD, hB);
      const sC = mi(hC, hD);
      const sD = mi(hD, hC);
      // Un quart : coin (sommet partagé), puis deux milieux de côtés dans le sens antihoraire vu du dessus, et le centre.
      const quart = (coin: number, hCoin: number, xb: number, zb: number, hb: number, xc: number, zc: number, hc: number, cl: number): void => {
        const coul = couleurDessus(cl);
        const v = bruit(c, l);
        const pm = sommet(xm, hCoin - z0, zm, 0, 1, 0, coul, v);
        const pb = sommet(xb, hb - z0, zb, 0, 1, 0, coul, v);
        const pc = sommet(xc, hc - z0, zc, 0, 1, 0, coul, v);
        triangle(iToits, coin, pb, pc);
        triangle(iToits, pb, pm, pc);
      };
      quart(iA, hA, x0, zm, wA, xm, z0q, nA, clA); // nord-ouest : milieu ouest, milieu nord
      quart(iB, hB, xm, z0q, nB, x1, zm, eB, clB); // nord-est : milieu nord, milieu est
      quart(iC, hC, xm, z1, sC, x0, zm, wC, clC); // sud-ouest : milieu sud, milieu ouest
      quart(iD, hD, x1, zm, eD, xm, z1, sD, clD); // sud-est : milieu est, milieu sud
      // Murs intérieurs : nord→centre (A|B), centre→sud (C|D), ouest→centre (A|C), centre→est (B|D).
      mur(xm, z0q, xm, zm, nA, hA, nB, hB, 1, 0, clA, clB);
      mur(xm, zm, xm, z1, hC, sC, hD, sD, 1, 0, clC, clD);
      mur(x0, zm, xm, zm, wA, hA, wC, hC, 0, 1, clA, clC);
      mur(xm, zm, x1, zm, hB, eB, hD, eD, 0, 1, clB, clD);
    }
  }
  return { positions: pos.fin(), normales: nor.fin(), couleurs: col.fin(), indicesToits: iToits.fin(), indicesMurs: iMurs.fin() };
}
