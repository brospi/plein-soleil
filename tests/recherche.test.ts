import { afterEach, describe, expect, it, vi } from 'vitest';
import { adresseIGN, adressePhoton, chercherAdresses, numeroDemande, numeroLePlusProche, numerosVoisins, trierParPrecision } from '../src/donnees/geocodage';
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

describe('numéro absent de la base d’adresses', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Géocodeur IGN simulé : seuls certains numéros existent sur l'avenue. */
  function simulerIGN(existants: Record<string, [number, number]>, rue = 'Avenue de montolivet', codePostal = '13012', ville = 'Marseille'): string[] {
    const demandes: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const q = new URL(url).searchParams.get('q')!;
      demandes.push(q);
      const numero = /^\d+/.exec(q)?.[0] ?? '';
      const commun = { street: rue, postcode: codePostal, city: ville, context: '13, Bouches-du-Rhône' };
      const feature = existants[numero]
        ? { geometry: { coordinates: [5.43, 43.32] }, properties: { ...commun, type: 'housenumber', housenumber: numero, name: `${numero} ${rue}`, label: `${numero} ${rue} ${codePostal} ${ville}`, x: existants[numero][0], y: existants[numero][1] } }
        : { geometry: { coordinates: [5.42, 43.31] }, properties: { ...commun, type: 'street', housenumber: null, name: rue, label: `${rue} ${codePostal} ${ville}`, x: 896225.49, y: 6249357.52 } };
      return new Response(JSON.stringify({ features: [feature] }), { status: 200 });
    });
    return demandes;
  }

  it('ordre des numéros essayés : d’abord les plus proches, même côté de la rue en premier', () => {
    expect(numerosVoisins('454')).toEqual([
      [452, 456, 453, 455, 450, 458],
      [451, 457, 448, 460, 449, 459, 446, 462, 444, 464],
    ]);
    // « 12 bis » : le 12 lui-même d'abord. Pas de numéro négatif ou nul.
    expect(numerosVoisins('12 bis')[0][0]).toBe(12);
    expect(numerosVoisins('2')[0]).toEqual([4, 1, 3, 6]);
  });

  it('454 avenue de Montolivet : placé sur le 452, libellé avec le numéro demandé', async () => {
    simulerIGN({ '452': [896795.37, 6249628.01], '444': [896700, 6249600] });
    const q = '454 avenue de Montolivet 13012 Marseille';
    const resultats = await chercherAdresses(q);
    expect(resultats[0].precision).toBe('rue');
    const voisin = (await numeroLePlusProche(q, resultats))!;
    expect(voisin.approche).toEqual({ demande: '454', trouve: '452' });
    expect(voisin.libelle).toBe('454 Avenue de montolivet 13012 Marseille');
    expect(voisin.x).toBeCloseTo(896795.37, 2);
    expect(voisin.y).toBeCloseTo(6249628.01, 2);
    expect(voisin.precision).toBe('numero');
  });

  it('seconde vague si rien à ±4, et choix du plus proche', async () => {
    simulerIGN({ '444': [1, 2], '462': [3, 4] });
    const q = '454 avenue de Montolivet 13012 Marseille';
    const voisin = (await numeroLePlusProche(q, await chercherAdresses(q)))!;
    // 462 (écart 8) est plus proche que 444 (écart 10).
    expect(voisin.approche!.trouve).toBe('462');
  });

  it('rien à ±10 numéros : on reste sur la rue', async () => {
    simulerIGN({ '400': [1, 2] });
    const q = '454 avenue de Montolivet 13012 Marseille';
    expect(await numeroLePlusProche(q, await chercherAdresses(q))).toBeNull();
  });

  it('n’interroge pas le service quand le numéro existe ou qu’aucun numéro n’est demandé', async () => {
    const demandes = simulerIGN({ '452': [1, 2] });
    const avecNumero = await chercherAdresses('452 avenue de Montolivet 13012 Marseille');
    expect(avecNumero[0].precision).toBe('numero');
    const sansNumero = await chercherAdresses('avenue de Montolivet 13012 Marseille');
    const avant = demandes.length;
    expect(await numeroLePlusProche('452 avenue de Montolivet 13012 Marseille', avecNumero)).toBeNull();
    expect(await numeroLePlusProche('avenue de Montolivet 13012 Marseille', sansNumero)).toBeNull();
    expect(demandes.length).toBe(avant);
  });

  it('un numéro trouvé sur une autre rue est écarté', async () => {
    simulerIGN({ '452': [1, 2] });
    const q = '454 avenue de Montolivet 13012 Marseille';
    const resultats = await chercherAdresses(q);
    // La rue suggérée ne porte pas le même nom que celle du numéro trouvé.
    resultats[0] = { ...resultats[0], rue: 'Boulevard de Montolivet' };
    expect(await numeroLePlusProche(q, resultats)).toBeNull();
  });
});
