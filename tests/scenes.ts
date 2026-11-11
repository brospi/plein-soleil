/** Scènes synthétiques pour les tests : terrain plat et bâtiments en boîtes. */
import { creerRaster, type Raster, SANS_DONNEE } from '../src/coeur/raster';
import { type Batiment, extruderBatiments } from '../src/coeur/facades';
import { type Scene } from '../src/coeur/calcul';
import { tableSolaire } from '../src/coeur/soleil';

export const X0 = 652000;
export const Y0 = 6862000;
export const SOL = 35;

export function boite(id: string, x: number, y: number, largeur: number, profondeur: number, hauteur: number): Batiment {
  // Rectangle antihoraire, coin sud-ouest en (x, y) relatif à l'origine de la scène.
  const pts = [x, y, x + largeur, y, x + largeur, y + profondeur, x, y + profondeur].map((v, i) => v + (i % 2 === 0 ? X0 : Y0));
  return { id, anneaux: [{ pts, trou: false }], hauteur, etages: null, usage: null };
}

let tableParis: ReturnType<typeof tableSolaire> | null = null;

/** Scène de `taille` m de côté au pas de 0,5 m ; `decalage` déplace le relief par rapport aux emprises. */
export function scene(batiments: Batiment[], taille = 300, decalage: [number, number] = [0, 0]): { scene: Scene; dur: Raster; arbres: Raster } {
  const n = taille * 2;
  const sol = creerRaster(X0 - taille / 2, Y0 + taille / 2, 0.5, n, n, SOL);
  const decales = batiments.map((b) => ({
    ...b,
    anneaux: b.anneaux.map((a) => ({ ...a, pts: a.pts.map((v, i) => v + decalage[i % 2]) })),
  }));
  const dur = extruderBatiments(sol, decales);
  const arbres = creerRaster(sol.x0, sol.y1, 0.5, n, n, SANS_DONNEE);
  tableParis ??= tableSolaire(48.8566, 2.3522);
  return {
    scene: { niveaux: [{ dur, arbres }], relief: { dur, mnt: sol }, table: tableParis, convergence: 0 },
    dur,
    arbres,
  };
}
