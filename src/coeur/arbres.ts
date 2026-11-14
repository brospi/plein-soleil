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
