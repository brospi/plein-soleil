/**
 * Zone chargée : les bâtiments et le relief fin ne sont téléchargés qu'autour
 * d'un centre. Quand la carte s'en éloigne, il faut recharger.
 */

/** Distance (m) entre le centre de la carte et celui de la zone au-delà de laquelle on recharge. */
export const SEUIL_RECHARGEMENT = 70;
/** En dessous de ce zoom, la carte couvre trop de terrain pour charger les bâtiments. */
export const ZOOM_MIN_RECHARGEMENT = 17;
/** Une fenêtre plus éloignée que cela du nouveau centre ne peut plus être calculée dans la zone. */
export const PORTEE_FENETRE = 150;

export function horsZone(carte: { x: number; y: number; zoom: number }, zone: { x: number; y: number }): boolean {
  if (carte.zoom < ZOOM_MIN_RECHARGEMENT) return false;
  return Math.hypot(carte.x - zone.x, carte.y - zone.y) > SEUIL_RECHARGEMENT;
}
