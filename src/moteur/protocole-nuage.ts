/** Messages échangés avec le worker du nuage de points. */

export type RequeteNuage =
  /** Points autour de (x, y) dans un carré de demi-côté `rayon`, sans renvoyer les nœuds déjà affichés. */
  | { type: 'zone'; zone: number; x: number; y: number; rayon: number; budget: number; presents: string[] }
  | { type: 'arreter' };

export type MessageNuage =
  /** Nœuds retenus pour la zone : l'interface libère les autres. */
  | { type: 'selection'; zone: number; cles: string[]; points: number; facteur: number; dalles: number }
  | {
      type: 'noeud';
      zone: number;
      cle: string;
      /** Coin de la dalle (Lambert 93) auquel les positions sont relatives. */
      origine: { x: number; y: number };
      niveau: number;
      /** x est, y altitude NGF, z sud (m). */
      positions: Float32Array;
      /** sRVB, 3 octets par point. */
      couleurs: Uint8Array;
    }
  | { type: 'fin'; zone: number }
  | { type: 'erreur'; zone: number; message: string };
