/**
 * Rayonnement direct par ciel clair — modèle ESRA (Rigollier, Bauer & Wald,
 * « On the clear sky model of the ESRA », Solar Energy 68, 2000).
 *
 *   Bn = I0 · ε · exp(−0,8662 · TL · m · δR(m))
 *
 * I0 : constante solaire ; ε : correction de distance Terre-Soleil ;
 * TL : trouble de Linke pour une masse d'air de 2 ; m : masse d'air optique
 * relative (Kasten & Young, 1989) ; δR : épaisseur optique de Rayleigh
 * (Kasten, 1996).
 */

export const CONSTANTE_SOLAIRE = 1361; // W/m²
/** Trouble de Linke par défaut : air clair de climat tempéré. */
export const TROUBLE_LINKE_DEFAUT = 3;

/** Masse d'air optique relative pour une hauteur apparente (degrés) et une altitude (m). */
export function masseAir(hauteur: number, altitude = 0): number {
  const h = Math.max(hauteur, 0);
  const pression = Math.exp(-altitude / 8434.5);
  return pression / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/** Épaisseur optique de Rayleigh intégrée. */
export function epaisseurRayleigh(m: number): number {
  if (m <= 20) {
    return 1 / (6.6296 + 1.7513 * m - 0.1202 * m * m + 0.0065 * m ** 3 - 0.000013 * m ** 4);
  }
  return 1 / (10.4 + 0.718 * m);
}

/**
 * Éclairement direct normal (W/m²) par ciel clair.
 * @param hauteur hauteur apparente du soleil, degrés
 * @param distanceUA distance Terre-Soleil, UA
 */
export function directNormal(
  hauteur: number,
  distanceUA = 1,
  altitude = 0,
  troubleLinke = TROUBLE_LINKE_DEFAUT,
): number {
  if (hauteur <= 0) return 0;
  const m = masseAir(hauteur, altitude);
  return (CONSTANTE_SOLAIRE / (distanceUA * distanceUA)) * Math.exp(-0.8662 * troubleLinke * m * epaisseurRayleigh(m));
}
