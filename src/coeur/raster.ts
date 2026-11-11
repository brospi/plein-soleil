/**
 * Grille d'altitudes géoréférencée en Lambert 93.
 * La ligne 0 est au nord ; chaque valeur représente une cellule carrée de côté `pas`.
 */
export interface Raster {
  /** Abscisse du bord ouest (m). */
  x0: number;
  /** Ordonnée du bord nord (m). */
  y1: number;
  /** Taille d'une cellule (m). */
  pas: number;
  largeur: number;
  hauteur: number;
  d: Float32Array;
}

export const SANS_DONNEE = -9999;

export function creerRaster(x0: number, y1: number, pas: number, largeur: number, hauteur: number, valeur = 0): Raster {
  const d = new Float32Array(largeur * hauteur);
  if (valeur !== 0) d.fill(valeur);
  return { x0, y1, pas, largeur, hauteur, d };
}

/** Valeur de la cellule contenant (x, y) ; `defaut` hors emprise. */
export function valeur(r: Raster, x: number, y: number, defaut = SANS_DONNEE): number {
  const c = Math.floor((x - r.x0) / r.pas);
  const l = Math.floor((r.y1 - y) / r.pas);
  if (c < 0 || l < 0 || c >= r.largeur || l >= r.hauteur) return defaut;
  return r.d[l * r.largeur + c];
}

/** Interpolation bilinéaire entre centres de cellules (pour les surfaces lisses : sol). */
export function valeurLisse(r: Raster, x: number, y: number, defaut = SANS_DONNEE): number {
  const fx = (x - r.x0) / r.pas - 0.5;
  const fy = (r.y1 - y) / r.pas - 0.5;
  const c0 = Math.max(0, Math.min(r.largeur - 1, Math.floor(fx)));
  const l0 = Math.max(0, Math.min(r.hauteur - 1, Math.floor(fy)));
  const c1 = Math.min(r.largeur - 1, c0 + 1);
  const l1 = Math.min(r.hauteur - 1, l0 + 1);
  if (fx < -1 || fy < -1 || fx > r.largeur || fy > r.hauteur) return defaut;
  const tx = Math.max(0, Math.min(1, fx - c0));
  const ty = Math.max(0, Math.min(1, fy - l0));
  const a = r.d[l0 * r.largeur + c0];
  const b = r.d[l0 * r.largeur + c1];
  const c = r.d[l1 * r.largeur + c0];
  const d = r.d[l1 * r.largeur + c1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Part des cellules sans donnée (valeurs ≤ −1000 ou NaN). */
export function partSansDonnee(r: Raster): number {
  let n = 0;
  for (let i = 0; i < r.d.length; i++) {
    const v = r.d[i];
    if (!(v > -1000)) n++;
  }
  return n / r.d.length;
}

/** Décode un tampon BIL float32 petit-boutiste renvoyé par le WMS. */
export function decoderBil(tampon: ArrayBuffer, x0: number, y1: number, pas: number, largeur: number, hauteur: number): Raster {
  if (tampon.byteLength !== largeur * hauteur * 4) {
    throw new Error(`Réponse altimétrique de taille inattendue (${tampon.byteLength} octets pour ${largeur}×${hauteur}).`);
  }
  // Les plateformes cibles sont toutes petit-boutistes ; une copie garantit l'alignement.
  const d = new Float32Array(tampon.slice(0));
  return { x0, y1, pas, largeur, hauteur, d };
}

/** Rééchantillonne `source` sur la grille de `cible` (interpolation bilinéaire). */
export function reechantillonner(source: Raster, cible: Pick<Raster, 'x0' | 'y1' | 'pas' | 'largeur' | 'hauteur'>): Raster {
  const r = creerRaster(cible.x0, cible.y1, cible.pas, cible.largeur, cible.hauteur);
  for (let l = 0; l < r.hauteur; l++) {
    const y = r.y1 - (l + 0.5) * r.pas;
    for (let c = 0; c < r.largeur; c++) {
      r.d[l * r.largeur + c] = valeurLisse(source, r.x0 + (c + 0.5) * r.pas, y);
    }
  }
  return r;
}
