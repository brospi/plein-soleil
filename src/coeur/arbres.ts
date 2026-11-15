/**
 * Arbres recensés par les villes : feuillage persistant ou caduc d'après le
 * genre botanique, et rattachement de la canopée LiDAR à l'arbre recensé le
 * plus proche.
 */
import { type Raster, creerRaster, SANS_DONNEE } from './raster';

export interface ArbreRecense {
  /** Position du tronc (Lambert 93). */
  x: number;
  y: number;
  genre: string;
  espece: string;
  /** Rayon de la couronne (m), quand l'inventaire le fournit. */
  rayon?: number | null;
}

/** Genres dont toutes les espèces courantes en ville gardent leur feuillage l'hiver. */
const GENRES_PERSISTANTS = new Set([
  // Conifères (sauf mélèze, métaséquoia, cyprès chauve et ginkgo, caducs)
  'pinus', 'cedrus', 'cupressus', 'cupressocyparis', 'cuprocyparis', 'chamaecyparis', 'thuja', 'thujopsis', 'platycladus', 'picea', 'abies', 'taxus', 'sequoia',
  'sequoiadendron', 'calocedrus', 'juniperus', 'tsuga', 'pseudotsuga', 'cryptomeria', 'araucaria', 'cunninghamia', 'cephalotaxus', 'sciadopitys', 'torreya',
  // Feuillus persistants
  'ilex', 'laurus', 'olea', 'eucalyptus', 'photinia', 'arbutus', 'citrus', 'eriobotrya', 'buxus', 'cinnamomum', 'acacia', 'phillyrea', 'osmanthus', 'pittosporum',
  'nerium', 'camellia', 'myrtus', 'feijoa', 'callistemon',
  // Palmiers
  'trachycarpus', 'phoenix', 'chamaerops', 'washingtonia', 'butia', 'jubaea',
]);

/** Espèces persistantes de genres par ailleurs caducs. */
const ESPECES_PERSISTANTES: Record<string, string[]> = {
  quercus: ['ilex', 'suber', 'coccifera', 'myrsinifolia', 'phillyreoides'],
  magnolia: ['grandiflora'],
  prunus: ['laurocerasus', 'lusitanica'],
  ligustrum: ['lucidum', 'japonicum'],
  viburnum: ['tinus', 'rhytidophyllum'],
  elaeagnus: ['ebbingei', 'x ebbingei', 'pungens'],
  cotoneaster: ['lacteus', 'salicifolius'],
};

const normaliser = (s: string | null | undefined): string =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^[x×]\s*/, '')
    .trim();

/** Vrai si l'arbre garde son feuillage en hiver, d'après son genre et son espèce. */
export function estPersistant(genre: string | null | undefined, espece?: string | null): boolean {
  const g = normaliser(genre);
  if (!g) return false;
  if (GENRES_PERSISTANTS.has(g)) return true;
  const especes = ESPECES_PERSISTANTES[g];
  if (!especes) return false;
  const e = normaliser(espece);
  return especes.some((nom) => e === nom || e.startsWith(`${nom} `));
}

export interface BilanInventaire {
  /** Arbres recensés dans l'emprise, et parmi eux les persistants. */
  recenses: number;
  persistants: number;
  /** Part de la canopée LiDAR rattachée à un arbre recensé (0 à 1). */
  partIdentifiee: number;
  /** Part de la canopée LiDAR rattachée à un arbre persistant (0 à 1). */
  partPersistante: number;
}

/** Rayon de rattachement (m) quand l'inventaire ne donne pas la couronne. */
const RAYON_DEFAUT = 7;

/**
 * Rattache chaque cellule de canopée à l'arbre recensé le plus proche (dans la
 * limite de sa couronne) et renvoie la canopée des seuls arbres persistants.
 * Une cellule sans arbre recensé à proximité reste « non identifiée ».
 *
 * @param arbres sommet de la végétation (SANS_DONNEE ailleurs)
 */
export function marquerPersistants(arbres: Raster, inventaire: ArbreRecense[]): { persistants: Raster; bilan: BilanInventaire } {
  const { largeur: L, hauteur: H, pas } = arbres;
  const persistants = creerRaster(arbres.x0, arbres.y1, pas, L, H, SANS_DONNEE);
  const distance = new Float32Array(L * H).fill(Infinity);
  const proprietaire = new Int32Array(L * H).fill(-1);
  let recenses = 0;
  let nbPersistants = 0;
  inventaire.forEach((a, indice) => {
    const cx = (a.x - arbres.x0) / pas;
    const cy = (arbres.y1 - a.y) / pas;
    if (cx < 0 || cy < 0 || cx >= L || cy >= H) return;
    recenses++;
    if (estPersistant(a.genre, a.espece)) nbPersistants++;
    // La couronne déborde un peu du rayon mesuré ; on garde une marge de 2 m.
    const rayon = (a.rayon && a.rayon > 0 ? Math.min(12, a.rayon + 2) : RAYON_DEFAUT) / pas;
    const c0 = Math.max(0, Math.floor(cx - rayon));
    const c1 = Math.min(L - 1, Math.ceil(cx + rayon));
    const l0 = Math.max(0, Math.floor(cy - rayon));
    const l1 = Math.min(H - 1, Math.ceil(cy + rayon));
    for (let l = l0; l <= l1; l++) {
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot(c + 0.5 - cx, l + 0.5 - cy);
        const i = l * L + c;
        if (d <= rayon && d < distance[i]) {
          distance[i] = d;
          proprietaire[i] = indice;
        }
      }
    }
  });
  let canopee = 0;
  let identifiee = 0;
  let persistante = 0;
  for (let i = 0; i < L * H; i++) {
    if (!(arbres.d[i] > -1000)) continue;
    canopee++;
    const p = proprietaire[i];
    if (p < 0) continue;
    identifiee++;
    if (estPersistant(inventaire[p].genre, inventaire[p].espece)) {
      persistants.d[i] = arbres.d[i];
      persistante++;
    }
  }
  return {
    persistants,
    bilan: { recenses, persistants: nbPersistants, partIdentifiee: canopee ? identifiee / canopee : 0, partPersistante: canopee ? persistante / canopee : 0 },
  };
}

/* ---------- Base des houppiers ---------- */

/**
 * Le LiDAR ne voit que le dessus des arbres. On suppose que le houppier d'un
 * arbre d'au moins `HAUTEUR_MIN_FUT` mètres commence au tiers de sa hauteur :
 * en dessous, le tronc laisse passer la lumière (et la vue).
 */
export const FRACTION_FUT = 1 / 3;
/** Hauteur (m) en dessous de laquelle la végétation reste un massif plein (haies, arbustes). */
export const HAUTEUR_MIN_FUT = 5;
/** Rayon (m) sur lequel on cherche le sommet de l'arbre auquel appartient une cellule. */
const RAYON_SOMMET = 3;
/** Épaisseur minimale (m) d'un houppier, et vide minimal (m) sous lui pour qu'il compte. */
const EPAISSEUR_MIN = 0.5;
const VIDE_MIN = 1.5;

/**
 * Altitude de la base du houppier de chaque cellule de canopée, ou SANS_DONNEE
 * si la végétation descend jusqu'au sol (arbuste, haie, arbre trop bas).
 *
 * La hauteur de l'arbre est celle du point le plus haut à moins de 3 m : les
 * bords d'un houppier, plus bas que son sommet, ont la même base que lui. Un
 * bord qui ne dépasse pas cette base d'au moins 50 cm (branches retombantes)
 * reçoit une base égale à son sommet : épaisseur nulle, il ne cache rien.
 *
 * @param arbres sommet de la végétation (SANS_DONNEE ailleurs)
 * @param sol altitude du sol sur la même grille (surface « dure » sous les arbres)
 */
export function basesHouppiers(arbres: Raster, sol: Raster): Raster {
  const { largeur: L, hauteur: H, pas } = arbres;
  const n = L * H;
  const haut = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = arbres.d[i];
    haut[i] = a > -1000 ? Math.max(0, a - sol.d[i]) : 0;
  }
  // Maximum glissant séparable (carré de côté 2r + 1).
  const r = Math.max(1, Math.round(RAYON_SOMMET / pas));
  const tmp = new Float32Array(n);
  const loc = new Float32Array(n);
  for (let l = 0; l < H; l++) {
    const o = l * L;
    for (let c = 0; c < L; c++) {
      let m = 0;
      for (let d = Math.max(0, c - r); d <= Math.min(L - 1, c + r); d++) if (haut[o + d] > m) m = haut[o + d];
      tmp[o + c] = m;
    }
  }
  for (let c = 0; c < L; c++) {
    for (let l = 0; l < H; l++) {
      let m = 0;
      for (let d = Math.max(0, l - r); d <= Math.min(H - 1, l + r); d++) if (tmp[d * L + c] > m) m = tmp[d * L + c];
      loc[l * L + c] = m;
    }
  }
  const bases = creerRaster(arbres.x0, arbres.y1, pas, L, H, SANS_DONNEE);
  for (let i = 0; i < n; i++) {
    const a = arbres.d[i];
    if (!(a > -1000) || loc[i] < HAUTEUR_MIN_FUT) continue;
    const s = sol.d[i];
    const base = s + loc[i] * FRACTION_FUT;
    if (base - s < VIDE_MIN) continue;
    bases.d[i] = a - base < EPAISSEUR_MIN ? a : base;
  }
  return bases;
}
