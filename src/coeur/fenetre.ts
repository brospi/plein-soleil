/**
 * Géométrie propre de la fenêtre : ombre portée par l'embrasure (tableaux et
 * linteau) et par un éventuel balcon ou auvent situé au-dessus.
 */

export interface Balcon {
  /** Avancée par rapport au nu de la façade (m). */
  profondeur: number;
  /** Distance entre le haut du vitrage et la sous-face du balcon (m). */
  degagement: number;
}

export interface GeometrieFenetre {
  largeur: number;
  hauteur: number;
  /** Retrait du vitrage par rapport au nu extérieur de la façade (m). */
  embrasure: number;
  balcon: Balcon | null;
}

export const FENETRE_DEFAUT: GeometrieFenetre = { largeur: 1.2, hauteur: 1.6, embrasure: 0.2, balcon: null };

/** Rectangle éclairé du vitrage, en fractions : x ∈ [xa, xb], z ∈ [0, zb] (z = 0 à l'appui). */
export interface RectangleEclaire {
  xa: number;
  xb: number;
  zb: number;
}

/**
 * Partie du vitrage atteinte par le soleil compte tenu de la seule géométrie
 * de la baie. `tanGamma` est la tangente de l'azimut relatif du soleil
 * (positif quand le soleil est du côté des x croissants), `tanProfil` la
 * tangente de l'angle de profil : tan(hauteur) / cos(azimut relatif).
 * Renvoie false si rien n'est éclairé.
 */
export function rectangleEclaire(
  g: GeometrieFenetre,
  tanGamma: number,
  tanProfil: number,
  avecBalcon: boolean,
  avecEmbrasure: boolean,
  sortie: RectangleEclaire,
): boolean {
  const e = avecEmbrasure ? g.embrasure : 0;
  const ombreCote = (e * Math.abs(tanGamma)) / g.largeur;
  if (ombreCote >= 1) return false;
  let ombreHaut = e * tanProfil;
  if (avecBalcon && g.balcon && g.balcon.profondeur > 0) {
    const ob = (g.balcon.profondeur + e) * tanProfil - g.balcon.degagement;
    if (ob > ombreHaut) ombreHaut = ob;
  }
  ombreHaut /= g.hauteur;
  if (ombreHaut >= 1) return false;
  if (tanGamma > 0) {
    sortie.xa = 0;
    sortie.xb = 1 - ombreCote;
  } else {
    sortie.xa = ombreCote;
    sortie.xb = 1;
  }
  sortie.zb = 1 - Math.max(0, ombreHaut);
  return true;
}

/** Nombre de points d'échantillonnage du vitrage en largeur et en hauteur. */
export function grilleEchantillons(g: GeometrieFenetre): { nx: number; nz: number } {
  return {
    nx: Math.max(2, Math.min(6, Math.round(g.largeur / 0.45))),
    nz: Math.max(2, Math.min(6, Math.round(g.hauteur / 0.4))),
  };
}
