import { describe, expect, it } from 'vitest';
import { versLambert93, depuisLambert93, convergenceMeridiens } from '../src/coeur/lambert93';

/** Références : PROJ 9 (pyproj), EPSG:4326 → EPSG:2154. */
const REFERENCES = [
  { nom: 'Paris Notre-Dame', lon: 2.3499, lat: 48.853, x: 652296.973, y: 6861636.359 },
  { nom: 'Lyon Bellecour', lon: 4.832, lat: 45.7578, x: 842395.128, y: 6519229.359 },
  { nom: 'Brest', lon: -4.4861, lat: 48.3904, x: 146632.979, y: 6836262.327 },
  { nom: 'Strasbourg', lon: 7.7521, lat: 48.5734, x: 1050362.695, y: 6840899.647 },
  { nom: 'Perpignan', lon: 2.8956, lat: 42.6887, x: 691433.749, y: 6176570.501 },
  { nom: 'Dunkerque', lon: 2.3768, lat: 51.0344, x: 656187.517, y: 7104472.924 },
  { nom: 'Origine de la projection', lon: 3.0, lat: 46.5, x: 700000.0, y: 6600000.0 },
  { nom: 'Montreuil', lon: 2.4433, lat: 48.8634, x: 659158.507, y: 6862740.388 },
];

describe('Lambert 93', () => {
  for (const r of REFERENCES) {
    it(`direct et inverse — ${r.nom}`, () => {
      const p = versLambert93(r.lon, r.lat);
      expect(Math.abs(p.x - r.x)).toBeLessThan(0.005);
      expect(Math.abs(p.y - r.y)).toBeLessThan(0.005);
      const g = depuisLambert93(r.x, r.y);
      expect(Math.abs(g.lon - r.lon)).toBeLessThan(1e-7);
      expect(Math.abs(g.lat - r.lat)).toBeLessThan(1e-7);
    });
  }
  it('convergence des méridiens cohérente avec la projection', () => {
    // Un déplacement vers le nord géographique dévie de −convergence dans la grille.
    for (const lon of [-4.5, 2.35, 7.75]) {
      const a = versLambert93(lon, 48);
      const b = versLambert93(lon, 48.01);
      const azGrille = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
      expect(Math.abs(azGrille + convergenceMeridiens(lon))).toBeLessThan(1e-3);
    }
  });
});
