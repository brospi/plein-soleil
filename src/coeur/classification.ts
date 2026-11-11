/**
 * Séparation bâti / végétation à partir de la carte de classes LiDAR HD de
 * l'IGN (couche WMS IGNF_LIDAR-HD_CLASS, image à palette fixe).
 *
 * On en tire deux surfaces :
 *  - la surface « dure » (sol, bâtiments, ponts…) : MNS où la végétation est
 *    remplacée par le sol ;
 *  - la canopée : altitude du sommet des arbres, là où il y en a.
 */
import { type Raster, creerRaster, valeurLisse, SANS_DONNEE } from './raster';

export enum Classe {
  Inconnu = 0,
  Sol = 1,
  Vegetation = 2,
  Batiment = 3,
  Eau = 4,
  Pont = 5,
  Sursol = 6,
  VegetationBasse = 7,
}

/** Palette de la couche « cartes-classes » (relevée sur le service et sa légende). */
const PALETTE: Array<[number, number, number, Classe]> = [
  [207, 150, 70, Classe.Sol],
  [90, 110, 40, Classe.VegetationBasse],
  [70, 150, 60, Classe.Vegetation],
  [180, 20, 20, Classe.Batiment],
  [40, 140, 140, Classe.Eau],
  [240, 240, 0, Classe.Pont],
  [255, 0, 0, Classe.Pont],
  [255, 0, 255, Classe.Sursol],
  [150, 150, 150, Classe.Inconnu],
];

/** Convertit une image RGBA de la carte de classes en grille de classes. */
export function decoderClasses(rgba: Uint8ClampedArray | Uint8Array, n: number): Uint8Array {
  const classes = new Uint8Array(n);
  let dernier = -1;
  let derniereClasse = Classe.Inconnu;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    if (a < 128) continue; // transparent : aucun point LiDAR
    const cle = (r << 16) | (g << 8) | b;
    if (cle === dernier) {
      classes[i] = derniereClasse;
      continue;
    }
    let meilleur = Classe.Inconnu;
    let dMin = 60 * 60 * 3; // au-delà, couleur inconnue
    for (const [pr, pg, pb, c] of PALETTE) {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < dMin) {
        dMin = d;
        meilleur = c;
      }
    }
    dernier = cle;
    derniereClasse = meilleur;
    classes[i] = meilleur;
  }
  return classes;
}

export interface Surfaces {
  /** Surface opaque permanente : sol + bâti (m NGF). */
  dur: Raster;
  /** Sommet de la végétation (m NGF), SANS_DONNEE ailleurs. */
  arbres: Raster;
  /** Classe retenue pour chaque cellule (après levée des ambiguïtés). */
  classes: Uint8Array;
}

/**
 * Construit les surfaces dure et arborée.
 *
 * Règle : une cellule classée végétation haute repose sur le sol (MNT). Une
 * cellule haute (> 2 m) dont la classe est « sol », « végétation basse »,
 * « eau » ou inconnue est ambiguë (frange de houppier ou bord de toit) : elle
 * prend la nature de ses voisines dans un rayon de 2 cellules.
 *
 * @param mns modèle numérique de surface
 * @param mnt modèle numérique de terrain (grille quelconque couvrant le MNS)
 * @param classes classes sur la grille du MNS, ou null si indisponibles
 */
export function construireSurfaces(mns: Raster, mnt: Raster, classes: Uint8Array | null): Surfaces {
  const { largeur: L, hauteur: H } = mns;
  const n = L * H;
  const dur = creerRaster(mns.x0, mns.y1, mns.pas, L, H);
  const arbres = creerRaster(mns.x0, mns.y1, mns.pas, L, H, SANS_DONNEE);
  const sortie = new Uint8Array(n);
  const sol = new Float32Array(n);
  const memeGrille = mnt.pas === mns.pas && mnt.x0 === mns.x0 && mnt.y1 === mns.y1 && mnt.largeur === L;
  for (let l = 0; l < H; l++) {
    const y = mns.y1 - (l + 0.5) * mns.pas;
    for (let c = 0; c < L; c++) {
      const i = l * L + c;
      let s = memeGrille ? mnt.d[i] : valeurLisse(mnt, mns.x0 + (c + 0.5) * mns.pas, y);
      let z = mns.d[i];
      if (!(z > -1000)) z = s > -1000 ? s : 0; // trou dans le MNS : on retombe sur le sol
      if (!(s > -1000)) s = z;
      sol[i] = s;
      dur.d[i] = z;
    }
  }
  if (!classes) {
    for (let i = 0; i < n; i++) sortie[i] = dur.d[i] - sol[i] > 2 ? Classe.Batiment : Classe.Sol;
    return { dur, arbres, classes: sortie };
  }
  const SEUIL = 2;
  // Première passe : cellules sans ambiguïté.
  for (let i = 0; i < n; i++) {
    const c = classes[i] as Classe;
    sortie[i] = c;
    if (c === Classe.Vegetation) {
      if (dur.d[i] - sol[i] > 0.5) arbres.d[i] = dur.d[i];
      dur.d[i] = sol[i];
    }
  }
  // Seconde passe : cellules hautes mal classées.
  const rayon = 2;
  for (let l = 0; l < H; l++) {
    for (let c = 0; c < L; c++) {
      const i = l * L + c;
      const cl = classes[i] as Classe;
      if (cl !== Classe.Sol && cl !== Classe.VegetationBasse && cl !== Classe.Inconnu && cl !== Classe.Eau) continue;
      if (dur.d[i] - sol[i] <= SEUIL) continue;
      let veg = 0;
      let bati = 0;
      for (let dl = -rayon; dl <= rayon; dl++) {
        const ll = l + dl;
        if (ll < 0 || ll >= H) continue;
        for (let dc = -rayon; dc <= rayon; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= L) continue;
          const v = classes[ll * L + cc] as Classe;
          if (v === Classe.Vegetation) veg++;
          else if (v === Classe.Batiment || v === Classe.Pont || v === Classe.Sursol) bati++;
        }
      }
      if (veg > 0 && veg >= bati) {
        arbres.d[i] = dur.d[i];
        dur.d[i] = sol[i];
        sortie[i] = Classe.Vegetation;
      } else if (bati > 0 || cl === Classe.Inconnu) {
        sortie[i] = cl === Classe.Inconnu && bati === 0 ? Classe.Sursol : Classe.Batiment;
      } else if (cl === Classe.Sol || cl === Classe.VegetationBasse) {
        // Classée au sol, rien de bâti ni d'arboré autour : artefact du MNS.
        dur.d[i] = sol[i];
      }
    }
  }
  return { dur, arbres, classes: sortie };
}
