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

const COULEUR_TOIT: RVB = [142, 149, 162];
const COULEUR_MUR: RVB = [216, 203, 180];
const COULEUR_SOL: RVB = [124, 122, 118];
const COULEUR_HERBE: RVB = [137, 165, 104];
const COULEUR_ARBRE: RVB = [72, 122, 62];
const COULEUR_TRONC: RVB = [58, 98, 52];
const COULEUR_PERSISTANT: RVB = [44, 92, 78];
const COULEUR_TRONC_PERSISTANT: RVB = [36, 74, 64];
const COULEUR_EAU: RVB = [112, 148, 176];
const COULEUR_PONT: RVB = [150, 150, 152];
const COULEUR_SURSOL: RVB = [178, 172, 162];

function couleurDessus(classe: number): RVB {
  switch (classe) {
    case Classe.Batiment:
      return COULEUR_TOIT;
    case Classe.Vegetation:
      return COULEUR_ARBRE;
    case Classe.VegetationPersistante:
      return COULEUR_PERSISTANT;
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
  if (classe === Classe.VegetationPersistante) return COULEUR_TRONC_PERSISTANT;
  if (classe === Classe.Batiment || classe === Classe.Sursol) return COULEUR_MUR;
  return COULEUR_PONT;
}

/** Variation pseudo-aléatoire stable (±1) pour animer les aplats. */
function bruit(c: number, l: number): number {
  let h = (c * 374761393 + l * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Lissage léger pour l'affichage : chaque cellule prend la moyenne de ses
 * voisines de hauteur proche (écart < tolérance). Le bruit du LiDAR sur les
 * toits et le sol s'efface, les arêtes de façade restent nettes.
 */
export function lisserRelief(h: Float32Array, largeur: number, hauteur: number, tolerance = 0.6, passes = 2): Float32Array {
  let source = h;
  for (let p = 0; p < passes; p++) {
    const sortie = new Float32Array(source.length);
    for (let l = 0; l < hauteur; l++) {
      for (let c = 0; c < largeur; c++) {
        const i = l * largeur + c;
        const z = source[i];
        let somme = z * 2;
        let poids = 2;
        for (let dl = -1; dl <= 1; dl++) {
          const ll = l + dl;
          if (ll < 0 || ll >= hauteur) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc;
            if ((dl === 0 && dc === 0) || cc < 0 || cc >= largeur) continue;
            const v = source[ll * largeur + cc];
            if (Math.abs(v - z) < tolerance) {
              somme += v;
              poids++;
            }
          }
        }
        sortie[i] = somme / poids;
      }
    }
    source = sortie;
  }
  return source;
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
      const v = cl === Classe.Vegetation || cl === Classe.VegetationPersistante ? bruit(c, l) * 2.2 + Math.min(2, (z - z0) / 25) : bruit(c, l);
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
    // (nax, naz) pointe de a vers b : normale géométrique de la face, du côté haut vers le côté bas.
    const fx = aHaut ? nax : -nax;
    const fz = aHaut ? naz : -naz;
    // Normale d'éclairage : celle de la façade réelle (pente locale du relief) si elle
    // regarde du même côté ; un mur oblique, maillé en escalier, est ainsi éclairé uniformément.
    let nx = fx;
    let nz = fz;
    if (murNx * fx + murNz * fz > 0.25) {
      nx = murNx;
      nz = murNz;
    }
    const c = couleurMur(aHaut ? clA : clB);
    const v = bruit(Math.round(x1), Math.round(z1)) * 0.25;
    const p1 = sommet(x1, h1a - z0, z1, nx, 0, nz, c, v);
    const p2 = sommet(x2, h2a - z0, z2, nx, 0, nz, c, v);
    const p3 = sommet(x2, h2b - z0, z2, nx, 0, nz, c, v - 1.5);
    const p4 = sommet(x1, h1b - z0, z1, nx, 0, nz, c, v - 1.5);
    // Orientation : face avant du côté de la normale.
    const ex = x2 - x1;
    const ez = z2 - z1;
    // (p2 − p1) × (p4 − p1), composantes horizontales : (−ez·dy, ex·dy) avec dy = h1b − h1a.
    const dy = h1b - h1a || h2b - h2a;
    const avant = -ez * dy * fx + ex * dy * fz > 0;
    if (avant) {
      triangle(iMurs, p1, p2, p4);
      triangle(iMurs, p2, p3, p4);
    } else {
      triangle(iMurs, p1, p4, p2);
      triangle(iMurs, p2, p4, p3);
    }
  };

  // Direction de la façade au voisinage d'un carré discontinu : opposé du gradient sur 4 × 4 cellules.
  let murNx = 0;
  let murNz = 0;
  const borne = (v: number): number => Math.max(-12, Math.min(12, v));
  const orienterMur = (c: number, l: number): void => {
    const cA = Math.max(0, c - 1);
    const cB = Math.min(largeur - 1, c + 2);
    const lA = Math.max(0, l - 1);
    const lB = Math.min(hauteur - 1, l + 2);
    let gx = 0;
    let gz = 0;
    for (let ll = lA; ll <= lB; ll++) gx += borne(h[ll * largeur + cB] - h[ll * largeur + cA]);
    for (let cc = cA; cc <= cB; cc++) gz += borne(h[lB * largeur + cc] - h[lA * largeur + cc]);
    const norme = Math.hypot(gx, gz);
    if (norme < 1e-3) {
      murNx = 0;
      murNz = 0;
    } else {
      murNx = -gx / norme;
      murNz = -gz / norme;
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
      orienterMur(c, l);
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

/* ---------- Houppiers posés sur des troncs ---------- */

const COULEUR_ECORCE: RVB = [96, 78, 60];
const COULEUR_DESSOUS: RVB = [44, 70, 40];
const COULEUR_DESSOUS_PERSISTANT: RVB = [30, 58, 50];

export interface OptionsHouppiers {
  /** Centre de la cellule (0, 0) dans le repère de la vue (x est, z sud), et altitude retranchée. */
  ox: number;
  oz: number;
  z0: number;
}

/**
 * Maille les houppiers comme des volumes posés en l'air : dessus et dessous
 * lissés (sommets partagés aux coins des cellules), flancs verticaux sur le
 * pourtour, et un tronc sous chaque sommet local.
 *
 * @param haut altitude du dessus du houppier, NaN hors houppier
 * @param base altitude du dessous du houppier
 * @param sol altitude du sol (pour le pied des troncs)
 * @param classes classe de chaque cellule (végétation ou persistant)
 */
export function maillerHouppiers(
  haut: Float32Array,
  base: Float32Array,
  sol: Float32Array,
  classes: Uint8Array,
  largeur: number,
  hauteur: number,
  pas: number,
  o: OptionsHouppiers,
): Maillage {
  const W = largeur;
  const H = hauteur;
  const estCouronne = (c: number, l: number): boolean => c >= 0 && l >= 0 && c < W && l < H && haut[l * W + c] === haut[l * W + c];
  let nb = 0;
  for (let i = 0; i < W * H; i++) if (haut[i] === haut[i]) nb++;
  const pos = new Tampon(new Float32Array(nb * 12 + 300), (k) => new Float32Array(k));
  const nor = new Tampon(new Int8Array(nb * 12 + 300), (k) => new Int8Array(k));
  const col = new Tampon(new Uint8Array(nb * 12 + 300), (k) => new Uint8Array(k));
  const iToits = new Tampon(new Uint32Array(nb * 12 + 60), (k) => new Uint32Array(k));
  const iMurs = new Tampon(new Uint32Array(nb * 6 + 60), (k) => new Uint32Array(k));
  const { ox, oz, z0 } = o;
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
  const triangle = (t: Tampon<Uint32Array>, a: number, b: number, c: number): void => {
    t.reserver(3);
    t.t[t.n++] = a;
    t.t[t.n++] = b;
    t.t[t.n++] = c;
  };

  // Hauteurs aux coins : moyenne des cellules de houppier qui s'y touchent.
  const WC = W + 1;
  const coinHaut = new Float32Array(WC * (H + 1)).fill(NaN);
  const coinBas = new Float32Array(WC * (H + 1)).fill(NaN);
  for (let ll = 0; ll <= H; ll++) {
    for (let cc = 0; cc <= W; cc++) {
      let sh = 0;
      let sb = 0;
      let n = 0;
      for (const [c, l] of [
        [cc - 1, ll - 1],
        [cc, ll - 1],
        [cc - 1, ll],
        [cc, ll],
      ]) {
        if (!estCouronne(c, l)) continue;
        sh += haut[l * W + c];
        sb += base[l * W + c];
        n++;
      }
      if (n) {
        coinHaut[ll * WC + cc] = sh / n;
        coinBas[ll * WC + cc] = sb / n;
      }
    }
  }
  const xCoin = (cc: number): number => ox + (cc - 0.5) * pas;
  const zCoin = (ll: number): number => oz + (ll - 0.5) * pas;
  // Sommets du dessus (normale d'après la pente) et du dessous, créés à la demande.
  const idHaut = new Int32Array(WC * (H + 1)).fill(-1);
  const idBas = new Int32Array(WC * (H + 1)).fill(-1);
  const pente = (cc: number, ll: number, dc: number, dl: number): number => {
    const a = coinHaut[Math.min(H, Math.max(0, ll + dl)) * WC + Math.min(W, Math.max(0, cc + dc))];
    const b = coinHaut[Math.min(H, Math.max(0, ll - dl)) * WC + Math.min(W, Math.max(0, cc - dc))];
    const ici = coinHaut[ll * WC + cc];
    const va = a === a ? a : ici;
    const vb = b === b ? b : ici;
    return Math.max(-3, Math.min(3, (va - vb) / (2 * pas)));
  };
  const dessus = (cc: number, ll: number, cl: number): number => {
    const k = ll * WC + cc;
    if (idHaut[k] < 0) {
      const gx = pente(cc, ll, 1, 0);
      const gz = pente(cc, ll, 0, 1);
      const norme = Math.hypot(gx, 1, gz);
      const v = bruit(cc, ll) * 2.2 + Math.min(2, (coinHaut[k] - z0) / 25);
      idHaut[k] = sommet(xCoin(cc), coinHaut[k] - z0, zCoin(ll), -gx / norme, 1 / norme, -gz / norme, couleurDessus(cl), v);
    }
    return idHaut[k];
  };
  const dessous = (cc: number, ll: number, cl: number): number => {
    const k = ll * WC + cc;
    if (idBas[k] < 0) {
      const c = cl === Classe.VegetationPersistante ? COULEUR_DESSOUS_PERSISTANT : COULEUR_DESSOUS;
      idBas[k] = sommet(xCoin(cc), coinBas[k] - z0, zCoin(ll), 0, -1, 0, c, bruit(cc + 7, ll) * 1.5);
    }
    return idBas[k];
  };
  // Flanc vertical d'une arête de cellule, de la base au sommet, normale vers l'extérieur.
  const flanc = (c1: number, l1: number, c2: number, l2: number, nx: number, nz: number, cl: number): void => {
    const coul = couleurMur(cl);
    const k1 = l1 * WC + c1;
    const k2 = l2 * WC + c2;
    const v = bruit(c1, l1) * 0.5;
    const a = sommet(xCoin(c1), coinBas[k1] - z0, zCoin(l1), nx, 0, nz, coul, v - 1);
    const b = sommet(xCoin(c2), coinBas[k2] - z0, zCoin(l2), nx, 0, nz, coul, v - 1);
    const h2 = sommet(xCoin(c2), coinHaut[k2] - z0, zCoin(l2), nx, 0, nz, coul, v);
    const h1 = sommet(xCoin(c1), coinHaut[k1] - z0, zCoin(l1), nx, 0, nz, coul, v);
    // Face avant du côté de la normale : (b − a) × (h1 − a) doit pointer vers (nx, nz).
    const ex = xCoin(c2) - xCoin(c1);
    const ez = zCoin(l2) - zCoin(l1);
    // Avec un vecteur vertical (0, 1, 0) : (ex, 0, ez) × (0, 1, 0) = (−ez, 0, ex).
    if (-ez * nx + ex * nz > 0) {
      triangle(iMurs, a, b, h1);
      triangle(iMurs, b, h2, h1);
    } else {
      triangle(iMurs, a, h1, b);
      triangle(iMurs, b, h1, h2);
    }
  };

  for (let l = 0; l < H; l++) {
    for (let c = 0; c < W; c++) {
      if (!estCouronne(c, l)) continue;
      const cl = classes[l * W + c];
      // Coins : nord-ouest (c, l), nord-est (c + 1, l), sud-ouest (c, l + 1), sud-est (c + 1, l + 1).
      const no = dessus(c, l, cl);
      const ne = dessus(c + 1, l, cl);
      const so = dessus(c, l + 1, cl);
      const se = dessus(c + 1, l + 1, cl);
      triangle(iToits, no, so, ne);
      triangle(iToits, ne, so, se);
      const bno = dessous(c, l, cl);
      const bne = dessous(c + 1, l, cl);
      const bso = dessous(c, l + 1, cl);
      const bse = dessous(c + 1, l + 1, cl);
      triangle(iToits, bno, bne, bso);
      triangle(iToits, bne, bse, bso);
      if (!estCouronne(c, l - 1)) flanc(c, l, c + 1, l, 0, -1, cl); // nord
      if (!estCouronne(c, l + 1)) flanc(c, l + 1, c + 1, l + 1, 0, 1, cl); // sud
      if (!estCouronne(c - 1, l)) flanc(c, l, c, l + 1, -1, 0, cl); // ouest
      if (!estCouronne(c + 1, l)) flanc(c + 1, l, c + 1, l + 1, 1, 0, cl); // est
    }
  }

  // Troncs : sous chaque sommet local (le plus haut dans un rayon de 2,5 m).
  const r = Math.max(1, Math.round(2.5 / pas));
  const COTES = 6;
  for (let l = 0; l < H; l++) {
    for (let c = 0; c < W; c++) {
      if (!estCouronne(c, l)) continue;
      const i = l * W + c;
      const h = haut[i];
      let maximum = true;
      for (let dl = -r; dl <= r && maximum; dl++) {
        for (let dc = -r; dc <= r; dc++) {
          if ((dl === 0 && dc === 0) || dl * dl + dc * dc > r * r || !estCouronne(c + dc, l + dl)) continue;
          const v = haut[(l + dl) * W + c + dc];
          // Égalité : on garde la première cellule rencontrée (ordre de lecture).
          if (v > h || (v === h && (dl < 0 || (dl === 0 && dc < 0)))) {
            maximum = false;
            break;
          }
        }
      }
      if (!maximum) continue;
      const pied = sol[i] - z0;
      const tete = Math.min(base[i] + 1, h) - z0;
      if (tete - pied < 1) continue;
      const rayon = Math.min(0.45, 0.12 + (h - sol[i]) * 0.012);
      const cx = ox + c * pas;
      const cz = oz + l * pas;
      const premier = pos.n / 3;
      for (let k = 0; k < COTES; k++) {
        const a = (k / COTES) * Math.PI * 2;
        const nx = Math.cos(a);
        const nz = Math.sin(a);
        sommet(cx + nx * rayon, pied, cz + nz * rayon, nx, 0, nz, COULEUR_ECORCE, bruit(c, l) * 0.5);
        sommet(cx + nx * rayon, tete, cz + nz * rayon, nx, 0, nz, COULEUR_ECORCE, bruit(c, l) * 0.5 + 0.8);
      }
      for (let k = 0; k < COTES; k++) {
        const b0 = premier + 2 * k;
        const b1 = premier + 2 * ((k + 1) % COTES);
        // Vu de l'extérieur, l'angle croissant (x vers z, soit est vers sud) tourne dans le sens horaire vu du dessus.
        triangle(iMurs, b0, b0 + 1, b1);
        triangle(iMurs, b1, b0 + 1, b1 + 1);
      }
    }
  }
  return { positions: pos.fin(), normales: nor.fin(), couleurs: col.fin(), indicesToits: iToits.fin(), indicesMurs: iMurs.fin() };
}

/** Réunit deux maillages en un seul (mêmes groupes : dessus, puis murs). */
export function fusionnerMaillages(a: Maillage, b: Maillage): Maillage {
  const na = a.positions.length / 3;
  const decaler = (t: Uint32Array): Uint32Array => {
    const r = new Uint32Array(t.length);
    for (let i = 0; i < t.length; i++) r[i] = t[i] + na;
    return r;
  };
  const concat = <T extends Float32Array | Int8Array | Uint8Array | Uint32Array>(x: T, y: T, creer: (n: number) => T): T => {
    const r = creer(x.length + y.length);
    r.set(x as never);
    r.set(y as never, x.length);
    return r;
  };
  return {
    positions: concat(a.positions, b.positions, (n) => new Float32Array(n)),
    normales: concat(a.normales, b.normales, (n) => new Int8Array(n)),
    couleurs: concat(a.couleurs, b.couleurs, (n) => new Uint8Array(n)),
    indicesToits: concat(a.indicesToits, decaler(b.indicesToits), (n) => new Uint32Array(n)),
    indicesMurs: concat(a.indicesMurs, decaler(b.indicesMurs), (n) => new Uint32Array(n)),
  };
}
