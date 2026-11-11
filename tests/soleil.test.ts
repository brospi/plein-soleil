import { describe, expect, it } from 'vitest';
import { positionSoleil, decalageParis, utcDepuisHeureLegale, tableSolaire, indexDuJour, CRENEAUX_PAR_JOUR, PAS_MINUTES } from '../src/coeur/soleil';

/**
 * Valeurs de référence : algorithme SPA du NREL (Reda & Andreas, 2004) via
 * pvlib 0.11 (`solarposition.spa_python`, ΔT = 69,2 s, 1013,25 hPa, 12 °C).
 */
const REFERENCES = [
  { utc: '2026-01-15T08:00Z', lat: 48.8566, lon: 2.3522, azimut: 126.0662, vraie: 2.0605, apparente: 2.3376 },
  { utc: '2026-01-15T12:00Z', lat: 48.8566, lon: 2.3522, azimut: 180.004, vraie: 20.0726, apparente: 20.1179 },
  { utc: '2026-03-20T07:30Z', lat: 48.8566, lon: 2.3522, azimut: 107.7877, vraie: 14.7883, apparente: 14.8502 },
  { utc: '2026-06-21T05:00Z', lat: 48.8566, lon: 2.3522, azimut: 64.9254, vraie: 9.3704, apparente: 9.4656 },
  { utc: '2026-06-21T11:50Z', lat: 48.8566, lon: 2.3522, azimut: 178.7138, vraie: 64.5758, apparente: 64.5838 },
  { utc: '2026-06-21T19:30Z', lat: 48.8566, lon: 2.3522, azimut: 303.2029, vraie: 2.8828, apparente: 3.115 },
  { utc: '2026-09-23T16:00Z', lat: 48.8566, lon: 2.3522, azimut: 249.8904, vraie: 16.3893, apparente: 16.4452 },
  { utc: '2026-12-21T15:00Z', lat: 48.8566, lon: 2.3522, azimut: 223.137, vraie: 6.0711, apparente: 6.2092 },
  { utc: '2026-12-21T11:52Z', lat: 48.8566, lon: 2.3522, azimut: 180.8059, vraie: 17.7003, apparente: 17.7519 },
  { utc: '2026-04-10T06:10Z', lat: 45.764, lon: 4.8357, azimut: 89.4065, vraie: 10.5709, apparente: 10.6562 },
  { utc: '2026-08-01T17:45Z', lat: 45.764, lon: 4.8357, azimut: 282.3386, vraie: 13.0419, apparente: 13.1119 },
  { utc: '2026-11-05T13:20Z', lat: 48.3904, lon: -4.4861, azimut: 200.6261, vraie: 23.4872, apparente: 23.5255 },
  { utc: '2026-07-14T04:20Z', lat: 48.5734, lon: 7.7521, azimut: 61.9997, vraie: 4.5673, apparente: 4.739 },
];

describe('position du soleil (NOAA) contre SPA', () => {
  for (const r of REFERENCES) {
    it(`${r.utc} (${r.lat}, ${r.lon})`, () => {
      const p = positionSoleil(Date.parse(r.utc), r.lat, r.lon);
      expect(Math.abs(p.azimut - r.azimut)).toBeLessThan(0.05);
      expect(Math.abs(p.hauteurVraie - r.vraie)).toBeLessThan(0.03);
      expect(Math.abs(p.hauteur - r.apparente)).toBeLessThan(0.05);
    });
  }
  it('exemple de la publication SPA (Golden, 17 oct. 2003)', () => {
    // Zénith topocentrique 50,11162°, azimut 194,34024° (Reda & Andreas, tableau A5).
    const p = positionSoleil(Date.UTC(2003, 9, 17, 19, 30, 30), 39.742476, -105.1786);
    expect(Math.abs(90 - p.hauteurVraie - 50.11162)).toBeLessThan(0.03);
    expect(Math.abs(p.azimut - 194.34024)).toBeLessThan(0.05);
  });
});

describe('heure légale', () => {
  it('heure d’hiver et heure d’été 2026', () => {
    expect(decalageParis(Date.UTC(2026, 0, 15, 12))).toBe(1);
    expect(decalageParis(Date.UTC(2026, 6, 15, 12))).toBe(2);
    // Passage à l'heure d'été : dimanche 29 mars 2026 à 01:00 UTC.
    expect(decalageParis(Date.UTC(2026, 2, 29, 0, 59))).toBe(1);
    expect(decalageParis(Date.UTC(2026, 2, 29, 1, 0))).toBe(2);
    // Retour à l'heure d'hiver : dimanche 25 octobre 2026 à 01:00 UTC.
    expect(decalageParis(Date.UTC(2026, 9, 25, 0, 59))).toBe(2);
    expect(decalageParis(Date.UTC(2026, 9, 25, 1, 0))).toBe(1);
  });
  it('conversion heure légale → UTC', () => {
    expect(utcDepuisHeureLegale(2026, 7, 1, 14, 0)).toBe(Date.UTC(2026, 6, 1, 12, 0));
    expect(utcDepuisHeureLegale(2026, 12, 1, 14, 0)).toBe(Date.UTC(2026, 11, 1, 13, 0));
  });
});

describe('table annuelle', () => {
  const table = tableSolaire(48.8566, 2.3522);
  const heure = (creneau: number) => (creneau * PAS_MINUTES) / 60;
  it('lever et coucher à Paris aux solstices (SPA : 05:47–21:58 et 08:41–16:56)', () => {
    const ete = indexDuJour(6, 21);
    expect(Math.abs(heure(table.lever[ete]) - (5 + 47 / 60))).toBeLessThan(0.08);
    expect(Math.abs(heure(table.coucher[ete] + 1) - (21 + 58 / 60))).toBeLessThan(0.08);
    const hiver = indexDuJour(12, 21);
    expect(Math.abs(heure(table.lever[hiver]) - (8 + 41 / 60))).toBeLessThan(0.08);
    expect(Math.abs(heure(table.coucher[hiver] + 1) - (16 + 56 / 60))).toBeLessThan(0.08);
  });
  it('la table reproduit le calcul direct', () => {
    const j = indexDuJour(5, 10);
    const c = 400; // 13 h 20 légales
    const ms = utcDepuisHeureLegale(2026, 5, 10, 0, 0) + (c + 0.5) * PAS_MINUTES * 60_000;
    const p = positionSoleil(ms, 48.8566, 2.3522);
    expect(Math.abs(table.hauteur[j * CRENEAUX_PAR_JOUR + c] - p.hauteur)).toBeLessThan(0.02);
    expect(Math.abs(table.azimut[j * CRENEAUX_PAR_JOUR + c] - p.azimut)).toBeLessThan(0.05);
  });
  it('environ 4 480 h de jour par an à Paris', () => {
    let n = 0;
    for (let i = 0; i < table.hauteur.length; i++) if (table.hauteur[i] > 0) n++;
    const heures = (n * PAS_MINUTES) / 60;
    expect(heures).toBeGreaterThan(4440);
    expect(heures).toBeLessThan(4520);
  });
});
