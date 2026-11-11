/**
 * Adresses des services de la Géoplateforme IGN (tous vérifiés en CORS ouvert).
 */

export const WMS_RASTER = 'https://data.geopf.fr/wms-r/wms';
export const WFS = 'https://data.geopf.fr/wfs/ows';
export const WMTS = 'https://data.geopf.fr/wmts';

export const COUCHE_MNS = 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93';
export const COUCHE_MNT = 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93';
export const COUCHE_CLASSES = 'IGNF_LIDAR-HD_CLASS';
/** RGE ALTI : terrain nu disponible partout, utilisé quand le LiDAR HD manque. */
export const COUCHE_RGE_ALTI = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';
export const COUCHE_ORTHO_WMS = 'HR.ORTHOIMAGERY.ORTHOPHOTOS';

export interface Emprise {
  /** Bord ouest, bord nord (m, Lambert 93). */
  x0: number;
  y1: number;
  pas: number;
  largeur: number;
  hauteur: number;
}

/**
 * Emprise carrée de `taille` cellules centrée au mieux sur (x, y) et calée
 * sur une grille de `calage` mètres : deux fenêtres voisines produisent la
 * même requête, donc le cache sert.
 */
export function empriseCalee(x: number, y: number, pas: number, taille: number, calage: number): Emprise {
  const cote = pas * taille;
  const x0 = Math.round((x - cote / 2) / calage) * calage;
  const y0 = Math.round((y - cote / 2) / calage) * calage;
  return { x0, y1: y0 + cote, pas, largeur: taille, hauteur: taille };
}

function getMap(couche: string, e: Emprise, format: string, largeur = e.largeur, hauteur = e.hauteur): string {
  const x1 = e.x0 + e.pas * e.largeur;
  const y0 = e.y1 - e.pas * e.hauteur;
  return (
    `${WMS_RASTER}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${couche}&STYLES=&CRS=EPSG:2154` +
    `&BBOX=${e.x0},${y0},${x1},${e.y1}&WIDTH=${largeur}&HEIGHT=${hauteur}&FORMAT=${encodeURIComponent(format)}`
  );
}

/** Altitudes en float32 petit-boutiste, ligne du haut au nord. */
export function urlAltitudes(couche: string, e: Emprise): string {
  return getMap(couche, e, 'image/x-bil;bits=32');
}

export function urlImage(couche: string, e: Emprise, format: 'image/png' | 'image/jpeg', largeur?: number, hauteur?: number): string {
  return getMap(couche, e, format, largeur, hauteur);
}

export function urlBatiments(x0: number, y0: number, x1: number, y1: number, debut: number, nombre: number): string {
  return (
    `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&SRSNAME=EPSG:2154` +
    `&BBOX=${x0},${y0},${x1},${y1},EPSG:2154&OUTPUTFORMAT=application/json&COUNT=${nombre}&STARTINDEX=${debut}`
  );
}

export function urlTuiles(couche: string, format: 'image/jpeg' | 'image/png'): string {
  return (
    `${WMTS}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=${couche}&STYLE=normal&TILEMATRIXSET=PM` +
    `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`
  );
}
