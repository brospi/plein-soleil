/**
 * Nuage de points de la vue 3D : choix des nœuds COPC à charger autour du
 * centre et mise en forme des points pour l'affichage.
 *
 * La densité décroît avec la distance, comme la finesse du maillage : un
 * nœud de niveau d est chargé s'il est à moins de `facteur × espacement(d)`
 * du centre. Ainsi l'écart entre points vus depuis le centre reste à peu
 * près le même angle, et le budget de points est tenu en réduisant le facteur.
 */
import { ClasseLas, type EnteteCopc, type Noeud, type PointsBruts, cleNoeud, empriseNoeud } from '../donnees/copc';

/** Au-delà, le nuage serait trop lourd à télécharger : le relief maillé prend le relais. */
export const RAYON_NUAGE_MAX = 1000;
export const FACTEUR_MAX = 260;
const FACTEUR_MIN = 40;

export interface DalleNuage {
  url: string;
  entete: EnteteCopc;
  noeuds: Noeud[];
}

export interface NoeudChoisi {
  /** Identifiant stable : fichier et nœud. */
  cle: string;
  url: string;
  noeud: Noeud;
  distance: number;
}

/** Distance horizontale d'un point à une emprise (0 à l'intérieur). */
function distanceEmprise(cx: number, cy: number, b: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = Math.max(0, b.x0 - cx, cx - b.x1);
  const dy = Math.max(0, b.y0 - cy, cy - b.y1);
  return Math.hypot(dx, dy);
}

/** Le nœud mérite-t-il d'être chargé avec ce facteur ? */
export function utile(e: EnteteCopc, n: Pick<Noeud, 'd' | 'x' | 'y'>, cx: number, cy: number, rayon: number, facteur: number): { ok: boolean; distance: number } {
  const b = empriseNoeud(e, n);
  // Zone carrée, comme le relief maillé.
  if (b.x1 < cx - rayon || b.x0 > cx + rayon || b.y1 < cy - rayon || b.y0 > cy + rayon) return { ok: false, distance: Infinity };
  const distance = distanceEmprise(cx, cy, b);
  const espacement = e.espacement / 2 ** n.d;
  return { ok: n.d === 0 || distance <= facteur * espacement, distance };
}

function selection(dalles: DalleNuage[], cx: number, cy: number, rayon: number, facteur: number): { choix: NoeudChoisi[]; points: number } {
  const choix: NoeudChoisi[] = [];
  let points = 0;
  for (const dalle of dalles) {
    for (const n of dalle.noeuds) {
      if (n.points <= 0) continue;
      const u = utile(dalle.entete, n, cx, cy, rayon, facteur);
      if (!u.ok) continue;
      choix.push({ cle: `${dalle.url}#${cleNoeud(n)}`, url: dalle.url, noeud: n, distance: u.distance });
      points += n.points;
    }
  }
  return { choix, points };
}

/**
 * Nœuds à charger, des plus grossiers aux plus fins puis des plus proches aux
 * plus lointains : la vue d'ensemble apparaît d'abord et se précise.
 */
export function choisirNoeuds(dalles: DalleNuage[], cx: number, cy: number, rayon: number, budget: number): { choix: NoeudChoisi[]; points: number; facteur: number } {
  let facteur = FACTEUR_MAX;
  let s = selection(dalles, cx, cy, rayon, facteur);
  while (s.points > budget && facteur > FACTEUR_MIN) {
    facteur = Math.max(FACTEUR_MIN, facteur * 0.85);
    s = selection(dalles, cx, cy, rayon, facteur);
  }
  s.choix.sort((a, b) => a.noeud.d - b.noeud.d || a.distance - b.distance);
  return { ...s, facteur };
}

/** Couleurs par classe (sRVB), proches de celles du relief maillé. */
const COULEURS: Record<number, [number, number, number]> = {
  [ClasseLas.Sol]: [132, 128, 120],
  [ClasseLas.VegetationBasse]: [137, 165, 104],
  [ClasseLas.VegetationMoyenne]: [96, 142, 74],
  [ClasseLas.VegetationHaute]: [68, 120, 58],
  [ClasseLas.Batiment]: [206, 192, 170],
  [ClasseLas.Eau]: [104, 142, 176],
  [ClasseLas.Pont]: [150, 150, 152],
  [ClasseLas.Sursol]: [178, 172, 162],
  [ClasseLas.DiversBati]: [178, 172, 162],
};
const COULEUR_AUTRE: [number, number, number] = [160, 156, 150];

/**
 * Couleur de chaque point : celle de sa classe, modulée par l'intensité du
 * retour laser (le relief des matériaux : marquages, joints, tuiles…).
 */
export function couleursPoints(p: PointsBruts): Uint8Array {
  const sortie = new Uint8Array(p.nombre * 3);
  // Intensité de référence : médiane approchée du bloc, pour un contraste stable d'une dalle à l'autre.
  let somme = 0;
  for (let i = 0; i < p.nombre; i++) somme += p.intensite[i];
  const moyenne = p.nombre ? somme / p.nombre : 1;
  for (let i = 0; i < p.nombre; i++) {
    const c = COULEURS[p.classe[i]] ?? COULEUR_AUTRE;
    const t = Math.max(0.72, Math.min(1.22, 0.75 + 0.25 * (p.intensite[i] / (moyenne || 1))));
    sortie[i * 3] = Math.min(255, c[0] * t);
    sortie[i * 3 + 1] = Math.min(255, c[1] * t);
    sortie[i * 3 + 2] = Math.min(255, c[2] * t);
  }
  return sortie;
}

/**
 * Positions dans le repère de la vue, relatives au coin de la dalle : x est,
 * y altitude NGF, z sud. L'objet three.js placé au coin les ramène au centre.
 */
export function positionsVue(p: PointsBruts): Float32Array {
  const sortie = new Float32Array(p.nombre * 3);
  for (let i = 0; i < p.nombre; i++) {
    sortie[i * 3] = p.xyz[i * 3];
    sortie[i * 3 + 1] = p.xyz[i * 3 + 2];
    sortie[i * 3 + 2] = -p.xyz[i * 3 + 1];
  }
  return sortie;
}

/**
 * Dalles LiDAR HD (fichiers COPC) qui recouvrent une emprise, d'après l'index
 * WFS de l'IGN. L'index compare des emprises en degrés et renvoie aussi des
 * dalles voisines : on ne garde que celles dont le nom (coin nord-ouest, en
 * km) recoupe vraiment l'emprise.
 */
export function lireIndexDalles(json: unknown, emprise?: { x0: number; y0: number; x1: number; y1: number }): string[] {
  const f = (json as { features?: { properties?: { url_npl?: unknown } }[] }).features ?? [];
  const urls = new Set<string>();
  for (const e of f) {
    const u = e.properties?.url_npl;
    if (typeof u !== 'string' || !u.endsWith('.copc.laz')) continue;
    const m = /LHD_[A-Z]+_(\d{4})_(\d{4})_/.exec(u);
    if (emprise && m) {
      const x0 = Number(m[1]) * 1000;
      const y1 = Number(m[2]) * 1000;
      if (x0 >= emprise.x1 || x0 + 1000 <= emprise.x0 || y1 <= emprise.y0 || y1 - 1000 >= emprise.y1) continue;
    }
    // L'index donne parfois des adresses en http : le site est servi en https.
    urls.add(u.replace(/^http:\/\//, 'https://'));
  }
  return [...urls];
}
