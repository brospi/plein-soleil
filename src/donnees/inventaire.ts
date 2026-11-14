/**
 * Inventaires d'arbres publiés par les villes (arbres publics seulement).
 * Tous deux vérifiés en CORS ouvert.
 */
import { type ArbreRecense } from '../coeur/arbres';
import { depuisLambert93, versLambert93 } from '../coeur/lambert93';

export interface SourceInventaire {
  /** Nom affiché (« Ville de Paris »). */
  nom: string;
  /** Vrai si la source couvre ce point. */
  couvre(lon: number, lat: number): boolean;
  /** Requête pour une emprise Lambert 93. */
  url(x0: number, y0: number, x1: number, y1: number): string;
  /** Convertit la réponse en arbres positionnés en Lambert 93. */
  lire(reponse: unknown): ArbreRecense[];
}

const texte = (v: unknown): string => (typeof v === 'string' ? v : '');

/** « Les arbres », Ville de Paris (opendata.paris.fr, licence ODbL) : alignements, jardins, cimetières, écoles. */
export const PARIS: SourceInventaire = {
  nom: 'Ville de Paris',
  couvre: (lon, lat) => lon > 2.224 && lon < 2.47 && lat > 48.815 && lat < 48.903,
  url(x0, y0, x1, y1) {
    const coins = [depuisLambert93(x0, y0), depuisLambert93(x1, y0), depuisLambert93(x0, y1), depuisLambert93(x1, y1)];
    const lons = coins.map((c) => c.lon);
    const lats = coins.map((c) => c.lat);
    const f = (v: number): string => v.toFixed(6);
    const filtre = `in_bbox(geo_point_2d,${f(Math.min(...lats))},${f(Math.min(...lons))},${f(Math.max(...lats))},${f(Math.max(...lons))})`;
    return `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/les-arbres/exports/json?select=${encodeURIComponent('geo_point_2d,genre,espece')}&where=${encodeURIComponent(filtre)}`;
  },
  lire(reponse) {
    if (!Array.isArray(reponse)) return [];
    const arbres: ArbreRecense[] = [];
    for (const r of reponse as Array<Record<string, unknown>>) {
      const p = r.geo_point_2d as { lon?: number; lat?: number } | null;
      if (!p || typeof p.lon !== 'number' || typeof p.lat !== 'number') continue;
      arbres.push({ ...versLambert93(p.lon, p.lat), genre: texte(r.genre), espece: texte(r.espece) });
    }
    return arbres;
  },
};

/** Arbres d'alignement de la Métropole de Lyon (data.grandlyon.com). */
export const LYON: SourceInventaire = {
  nom: 'Métropole de Lyon',
  couvre: (lon, lat) => lon > 4.68 && lon < 5.07 && lat > 45.55 && lat < 45.95,
  url(x0, y0, x1, y1) {
    return (
      'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature' +
      '&typename=metropole-de-lyon:abr_arbres_alignement.abrarbre&outputFormat=application/json&SRSNAME=EPSG:2154' +
      `&BBOX=${Math.floor(x0)},${Math.floor(y0)},${Math.ceil(x1)},${Math.ceil(y1)},EPSG:2154&propertyName=genre,espece,rayoncouronne_m,the_geom&count=5000`
    );
  },
  lire(reponse) {
    const features = (reponse as { features?: Array<{ geometry?: { coordinates?: number[] } | null; properties?: Record<string, unknown> }> } | null)?.features;
    if (!Array.isArray(features)) return [];
    const arbres: ArbreRecense[] = [];
    for (const f of features) {
      const c = f.geometry?.coordinates;
      if (!c || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
      const p = f.properties ?? {};
      arbres.push({ x: c[0], y: c[1], genre: texte(p.genre), espece: texte(p.espece), rayon: typeof p.rayoncouronne_m === 'number' ? p.rayoncouronne_m : null });
    }
    return arbres;
  },
};

const SOURCES = [PARIS, LYON];

/** Inventaire couvrant un point Lambert 93, s'il en existe un. */
export function sourceInventaire(x: number, y: number): SourceInventaire | null {
  const { lon, lat } = depuisLambert93(x, y);
  return SOURCES.find((s) => s.couvre(lon, lat)) ?? null;
}
