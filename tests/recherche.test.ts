import { describe, expect, it } from 'vitest';
import { adresseIGN, adressePhoton, numeroDemande, trierParPrecision } from '../src/donnees/geocodage';
import { horsZone, SEUIL_RECHARGEMENT } from '../src/ui/zone';

describe('numéro de voie demandé', () => {
  it('reconnaît un numéro en tête de saisie', () => {
    expect(numeroDemande('454 avenue de Montolivet 13012 Marseille')).toBe('454');
    expect(numeroDemande('  12 bis rue de la Roquette')).toBe('12 bis');
    expect(numeroDemande('7B, rue Oberkampf')).toBe('7 b');
    expect(numeroDemande('3, place de la Bastille')).toBe('3');
  });
  it('ne confond pas avec un code postal, une année ou une rue sans numéro', () => {
    expect(numeroDemande('13012 Marseille')).toBeNull();
    expect(numeroDemande('avenue de Montolivet 13012 Marseille')).toBeNull();
    expect(numeroDemande('rue du 8 mai 1945')).toBeNull();
    expect(numeroDemande('')).toBeNull();
  });
});

describe('précision des résultats', () => {
  const point = { coordinates: [5.4296, 43.3187] as [number, number] };
  it('Photon : numéro, rue entière, lieu', () => {
    const numero = adressePhoton({ geometry: point, properties: { housenumber: '454', street: 'Avenue de Montolivet', postcode: '13012', city: 'Marseille', countrycode: 'FR', type: 'house' } })!;
    expect(numero.precision).toBe('numero');
    expect(numero.libelle).toBe('454 Avenue de Montolivet, 13012 Marseille');
    const rue = adressePhoton({ geometry: point, properties: { name: 'Avenue de Montolivet', postcode: '13012', city: 'Marseille', countrycode: 'FR', type: 'street' } })!;
    expect(rue.precision).toBe('rue');
    expect(rue.libelle).toBe('Avenue de Montolivet, 13012 Marseille');
    const lieu = adressePhoton({ geometry: point, properties: { name: 'Parc de Montolivet', city: 'Marseille', countrycode: 'FR', type: 'house' } })!;
    expect(lieu.precision).toBe('lieu');
    // Hors de France : écarté.
    expect(adressePhoton({ geometry: point, properties: { name: 'Marseille Street', countrycode: 'GB', type: 'street' } })).toBeNull();
    // Coordonnées Lambert 93 cohérentes (Marseille).
    expect(rue.x).toBeGreaterThan(890_000);
    expect(rue.x).toBeLessThan(905_000);
  });
  it('IGN : types « housenumber », « street », autres', () => {
    expect(adresseIGN({ geometry: point, properties: { label: '454 Avenue de Montolivet 13012 Marseille', type: 'housenumber', x: 897000, y: 6249000 } }).precision).toBe('numero');
    expect(adresseIGN({ geometry: point, properties: { label: 'Avenue de Montolivet 13012 Marseille', type: 'street' } }).precision).toBe('rue');
    expect(adresseIGN({ geometry: point, properties: { label: 'Marseille', type: 'municipality' } }).precision).toBe('lieu');
  });
  it('si un numéro est demandé, les adresses qui le localisent passent en tête', () => {
    const rue = adressePhoton({ geometry: point, properties: { name: 'Avenue de Montolivet', city: 'Marseille', type: 'street' } })!;
    const numero = adressePhoton({ geometry: point, properties: { housenumber: '454', street: 'Avenue de Montolivet', city: 'Marseille' } })!;
    expect(trierParPrecision('454 avenue de Montolivet', [rue, numero])).toEqual([numero, rue]);
    expect(trierParPrecision('avenue de Montolivet', [rue, numero])).toEqual([rue, numero]);
  });
});

describe('zone chargée', () => {
  const zone = { x: 652000, y: 6862000 };
  it('recharge au-delà du seuil, pas en deçà', () => {
    expect(horsZone({ x: 652000 + SEUIL_RECHARGEMENT - 5, y: 6862000, zoom: 19 }, zone)).toBe(false);
    expect(horsZone({ x: 652000 + SEUIL_RECHARGEMENT + 5, y: 6862000, zoom: 19 }, zone)).toBe(true);
    expect(horsZone({ x: 652060, y: 6862060, zoom: 19 }, zone)).toBe(true);
  });
  it('ne recharge pas quand la carte est trop dézoomée', () => {
    expect(horsZone({ x: 655000, y: 6862000, zoom: 14 }, zone)).toBe(false);
  });
});
