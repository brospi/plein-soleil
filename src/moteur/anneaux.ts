/**
 * Maillage 3D en anneaux concentriques : détail fin autour de la fenêtre,
 * relief de plus en plus grossier avec la distance. Chaque anneau saute la
 * zone déjà couverte par l'anneau précédent, plus fin.
 */
import { type Raster } from '../coeur/raster';
import { Classe } from '../coeur/classification';
import { type Maillage, lisserRelief, maillerRelief } from '../coeur/maillage';
import { type Niveau } from '../coeur/horizon';

export interface DefinitionAnneau {
  /** Niveau de relief utilisé : 0 (0,5 m), 1 (2 m) ou 2 (8 m). */
  niveau: number;
  /** Regroupement de cellules (2 : une cellule pour 2 × 2), en gardant la plus haute. */
  facteur: number;
  /** Rayon extérieur (m) autour du centre de la vue. */
  rayon: number;
  /** Dénivelé (m) au-delà duquel un mur vertical est tracé. */
  seuil: number;
}

export interface Etendue {
  id: string;
  libelle: string;
  anneaux: DefinitionAnneau[];
}

/**
 * Étendues proposées. Le coût reste à peu près constant par anneau : la taille
 * des cellules croît avec la distance. « Standard » reproduit le comportement
 * antérieur.
 */
export const ETENDUES: Etendue[] = [
  {
    id: 'compacte',
    libelle: 'Compacte · 300 m',
    anneaux: [
      { niveau: 0, facteur: 1, rayon: 90, seuil: 1.2 },
      { niveau: 1, facteur: 1, rayon: 300, seuil: 3 },
    ],
  },
  {
    id: 'standard',
    libelle: 'Standard · 450 m',
    anneaux: [
      { niveau: 0, facteur: 1, rayon: 150, seuil: 1.2 },
      { niveau: 1, facteur: 1, rayon: 460, seuil: 3 },
    ],
  },
  {
    id: 'large',
    libelle: 'Large · 1 km',
    anneaux: [
      { niveau: 0, facteur: 1, rayon: 150, seuil: 1.2 },
      { niveau: 1, facteur: 1, rayon: 500, seuil: 3 },
      { niveau: 1, facteur: 2, rayon: 1000, seuil: 5 },
    ],
  },
  {
    id: 'tres-large',
    libelle: 'Très large · 2,5 km',
    anneaux: [
      { niveau: 0, facteur: 1, rayon: 150, seuil: 1.2 },
      { niveau: 1, facteur: 1, rayon: 500, seuil: 3 },
      { niveau: 1, facteur: 2, rayon: 1000, seuil: 5 },
      { niveau: 2, facteur: 1, rayon: 1800, seuil: 10 },
      { niveau: 2, facteur: 2, rayon: 2500, seuil: 18 },
    ],
  },
  {
    id: 'maximale',
    libelle: 'Maximale · 4 km',
    anneaux: [
      { niveau: 0, facteur: 1, rayon: 150, seuil: 1.2 },
      { niveau: 1, facteur: 1, rayon: 500, seuil: 3 },
      { niveau: 1, facteur: 2, rayon: 1000, seuil: 5 },
      { niveau: 2, facteur: 1, rayon: 2000, seuil: 10 },
      { niveau: 2, facteur: 2, rayon: 4000, seuil: 18 },
    ],
  },
];

export const ETENDUE_DEFAUT = 'standard';
export const ETENDUE_MOBILE = 'compacte';

export function etendue(id: string | null | undefined): Etendue {
  return ETENDUES.find((e) => e.id === id) ?? ETENDUES.find((e) => e.id === ETENDUE_DEFAUT)!;
}

export interface AnneauMaille {
  maillage: Maillage;
  /** Taille des cellules (m) et rayon couvert (m). */
  pas: number;
  rayon: number;
}

interface Grille {
  h: Float32Array;
  cl: Uint8Array;
  largeur: number;
  hauteur: number;
  pas: number;
  /** Centre de la cellule (0, 0) dans le repère de la vue (x est, z sud). */
  ox: number;
  oz: number;
}

/**
 * Découpe un carré de rayon donné dans un niveau de relief, en regroupant les
 * cellules par `facteur` (on garde la plus haute, et sa classe).
 */
export function extraireGrille(
  niveau: Niveau,
  classes: Uint8Array | null,
  x: number,
  y: number,
  rayon: number,
  facteur = 1,
): Grille {
  const dur = niveau.dur;
  const arbres = niveau.arbres;
  const persistants = niveau.persistants ?? null;
  const pasFin = dur.pas;
  const pas = pasFin * facteur;
  // Calage sur la grille grossière pour que les cellules regroupées soient alignées.
  const c0 = Math.max(0, Math.floor((x - rayon - dur.x0) / pas) * facteur);
  const l0 = Math.max(0, Math.floor((dur.y1 - (y + rayon)) / pas) * facteur);
  const c1 = Math.min(dur.largeur, Math.ceil((x + rayon - dur.x0) / pasFin));
  const l1 = Math.min(dur.hauteur, Math.ceil((dur.y1 - (y - rayon)) / pasFin));
  const largeur = Math.max(0, Math.floor((c1 - c0) / facteur));
  const hauteur = Math.max(0, Math.floor((l1 - l0) / facteur));
  const h = new Float32Array(largeur * hauteur);
  const cl = new Uint8Array(largeur * hauteur);
  for (let l = 0; l < hauteur; l++) {
    for (let c = 0; c < largeur; c++) {
      let haut = -Infinity;
      let classe: number = Classe.Sol;
      for (let dl = 0; dl < facteur; dl++) {
        for (let dc = 0; dc < facteur; dc++) {
          const i = (l0 + l * facteur + dl) * dur.largeur + (c0 + c * facteur + dc);
          const a = arbres ? arbres.d[i] : -9999;
          let z: number;
          let k: number;
          if (a > -1000) {
            z = a;
            k = persistants && persistants.d[i] > -1000 ? Classe.VegetationPersistante : Classe.Vegetation;
          } else {
            z = Math.max(dur.d[i], -100);
            k = classes ? (classes[i] === Classe.Vegetation ? Classe.Sol : classes[i]) : Classe.Inconnu;
          }
          if (z > haut) {
            haut = z;
            classe = k;
          }
        }
      }
      h[l * largeur + c] = haut;
      cl[l * largeur + c] = classe;
    }
  }
  if (!classes) classerParHauteur(h, cl, largeur, hauteur, pas);
  return {
    h,
    cl,
    largeur,
    hauteur,
    pas,
    ox: dur.x0 + c0 * pasFin + pas / 2 - x,
    oz: y - (dur.y1 - l0 * pasFin - pas / 2),
  };
}

/**
 * Sans carte de classes (relief lointain), distingue toits et sol : une cellule
 * qui dépasse de 4 m le point le plus bas de son voisinage (environ 40 m) est
 * comptée comme bâtie.
 */
export function classerParHauteur(h: Float32Array, cl: Uint8Array, largeur: number, hauteur: number, pas: number): void {
  const r = Math.max(1, Math.round(20 / pas));
  // Minimum glissant séparable (lignes puis colonnes).
  const tmp = new Float32Array(h.length);
  const min = new Float32Array(h.length);
  for (let l = 0; l < hauteur; l++) {
    for (let c = 0; c < largeur; c++) {
      let m = Infinity;
      for (let d = Math.max(0, c - r); d <= Math.min(largeur - 1, c + r); d++) m = Math.min(m, h[l * largeur + d]);
      tmp[l * largeur + c] = m;
    }
  }
  for (let c = 0; c < largeur; c++) {
    for (let l = 0; l < hauteur; l++) {
      let m = Infinity;
      for (let d = Math.max(0, l - r); d <= Math.min(hauteur - 1, l + r); d++) m = Math.min(m, tmp[d * largeur + c]);
      min[l * largeur + c] = m;
    }
  }
  for (let i = 0; i < h.length; i++) {
    if (cl[i] !== Classe.Inconnu) continue;
    cl[i] = h[i] - min[i] > 4 ? Classe.Batiment : Classe.Sol;
  }
}

/** Maille tous les anneaux d'une étendue autour de (x, y). `z0` : altitude ramenée à 0 dans la vue. */
export function maillerAnneaux(
  niveaux: Niveau[],
  classesParNiveau: Array<Uint8Array | null>,
  x: number,
  y: number,
  z0: number,
  definitions: DefinitionAnneau[],
): AnneauMaille[] {
  const resultat: AnneauMaille[] = [];
  let couvert: { xMin: number; xMax: number; zMin: number; zMax: number } | null = null;
  for (const d of definitions) {
    const niveau = niveaux[d.niveau];
    if (!niveau) continue;
    const g = extraireGrille(niveau, classesParNiveau[d.niveau] ?? null, x, y, d.rayon, d.facteur);
    if (g.largeur < 2 || g.hauteur < 2) continue;
    let exclure: { c0: number; c1: number; l0: number; l1: number } | undefined;
    if (couvert) {
      // Carrés de cet anneau entièrement contenus dans la zone déjà maillée plus finement.
      exclure = {
        c0: Math.ceil((couvert.xMin - g.ox) / g.pas),
        c1: Math.floor((couvert.xMax - g.ox) / g.pas),
        l0: Math.ceil((couvert.zMin - g.oz) / g.pas),
        l1: Math.floor((couvert.zMax - g.oz) / g.pas),
      };
    }
    const h = d.niveau === 0 && d.facteur === 1 ? lisserRelief(g.h, g.largeur, g.hauteur) : g.h;
    const maillage = maillerRelief(h, g.cl, g.largeur, g.hauteur, g.pas, { seuil: d.seuil, ox: g.ox, oz: g.oz, z0, exclure });
    resultat.push({ maillage, pas: g.pas, rayon: d.rayon });
    // Zone couverte (centres des cellules extrêmes), réduite d'une demi-cellule pour éviter les trous.
    const zone = { xMin: g.ox + g.pas / 2, xMax: g.ox + (g.largeur - 1) * g.pas - g.pas / 2, zMin: g.oz + g.pas / 2, zMax: g.oz + (g.hauteur - 1) * g.pas - g.pas / 2 };
    couvert = couvert
      ? { xMin: Math.min(couvert.xMin, zone.xMin), xMax: Math.max(couvert.xMax, zone.xMax), zMin: Math.min(couvert.zMin, zone.zMin), zMax: Math.max(couvert.zMax, zone.zMax) }
      : zone;
  }
  return resultat;
}

/** Taille d'un ensemble d'anneaux : sommets, triangles et mémoire graphique approximative (octets). */
export function coutAnneaux(anneaux: AnneauMaille[]): { sommets: number; triangles: number; octets: number } {
  let sommets = 0;
  let indices = 0;
  for (const a of anneaux) {
    sommets += a.maillage.positions.length / 3;
    indices += a.maillage.indicesToits.length + a.maillage.indicesMurs.length;
  }
  // Par sommet : position (12 o), normale (3 o), couleur (12 o), coordonnées de texture (8 o).
  return { sommets, triangles: indices / 3, octets: sommets * 35 + indices * 4 };
}

/** Rayon de la zone où la caméra peut se promener : les anneaux de 4 m au plus. */
export function rayonPromenade(definitions: DefinitionAnneau[], niveaux: Pick<Raster, 'pas'>[]): number {
  let r = 0;
  for (const d of definitions) if ((niveaux[d.niveau]?.pas ?? Infinity) * d.facteur <= 4) r = Math.max(r, d.rayon);
  return r || definitions[0]?.rayon || 150;
}
