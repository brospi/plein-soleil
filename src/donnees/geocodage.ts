/**
 * Recherche d'adresse : Géoplateforme IGN, avec repli automatique sur Photon
 * (données OpenStreetMap) quand le service IGN est en panne ou trop lent.
 */
import { versLambert93 } from '../coeur/lambert93';

export interface Adresse {
  libelle: string;
  /** Précision : numéro, rue, lieu-dit… */
  contexte: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  source: 'ign' | 'osm';
}

const URL_IGN = 'https://data.geopf.fr/geocodage/search';
const URL_PHOTON = 'https://photon.komoot.io/api/';

/** Après un échec, l'IGN est mis de côté pendant une minute pour garder la saisie fluide. */
let ignIndisponibleJusqua = 0;

async function avecDelai(url: string, ms: number, signal?: AbortSignal): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  signal?.addEventListener('abort', () => c.abort());
  try {
    return await fetch(url, { signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

interface ProprietesIGN {
  label?: string;
  context?: string;
  type?: string;
  x?: number;
  y?: number;
}

async function chercherIGN(q: string, signal?: AbortSignal): Promise<Adresse[]> {
  const r = await avecDelai(`${URL_IGN}?q=${encodeURIComponent(q)}&autocomplete=1&index=address&limit=6`, 3500, signal);
  if (!r.ok) throw new Error(`IGN ${r.status}`);
  const geo = (await r.json()) as { features: Array<{ geometry: { coordinates: [number, number] }; properties: ProprietesIGN }> };
  return geo.features.map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;
    // Le service fournit x/y en Lambert 93 ; à défaut on projette nous-mêmes.
    const l93 = typeof p.x === 'number' && typeof p.y === 'number' && p.x > 0 ? { x: p.x, y: p.y } : versLambert93(lon, lat);
    return { libelle: p.label ?? '', contexte: p.context ?? '', lon, lat, x: l93.x, y: l93.y, source: 'ign' as const };
  });
}

interface ProprietesPhoton {
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  district?: string;
  state?: string;
  countrycode?: string;
  type?: string;
}

async function chercherPhoton(q: string, signal?: AbortSignal): Promise<Adresse[]> {
  const url = `${URL_PHOTON}?q=${encodeURIComponent(q)}&lang=fr&limit=8&bbox=-5.5,41.2,9.8,51.3`;
  const r = await avecDelai(url, 6000, signal);
  if (!r.ok) throw new Error(`Photon ${r.status}`);
  const geo = (await r.json()) as { features: Array<{ geometry: { coordinates: [number, number] }; properties: ProprietesPhoton }> };
  const vus = new Set<string>();
  const resultats: Adresse[] = [];
  for (const f of geo.features) {
    const p = f.properties;
    if (p.countrycode && p.countrycode !== 'FR') continue;
    const [lon, lat] = f.geometry.coordinates;
    const voie = [p.housenumber, p.street ?? (p.type === 'street' ? p.name : undefined)].filter(Boolean).join(' ');
    const libelle = [voie || p.name, [p.postcode, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (!libelle || vus.has(libelle)) continue;
    vus.add(libelle);
    const l93 = versLambert93(lon, lat);
    resultats.push({ libelle, contexte: [p.district, p.state].filter(Boolean).join(', '), lon, lat, x: l93.x, y: l93.y, source: 'osm' });
    if (resultats.length >= 6) break;
  }
  return resultats;
}

/** Propositions d'adresses pour une saisie ; lève une erreur si les deux services échouent. */
export async function chercherAdresses(q: string, signal?: AbortSignal): Promise<Adresse[]> {
  const texte = q.trim();
  if (texte.length < 3) return [];
  if (Date.now() >= ignIndisponibleJusqua) {
    try {
      return await chercherIGN(texte, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      ignIndisponibleJusqua = Date.now() + 60_000;
    }
  }
  try {
    return await chercherPhoton(texte, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error('La recherche d’adresse est momentanément indisponible (services IGN et OpenStreetMap injoignables). Réessayez dans un instant.');
  }
}
