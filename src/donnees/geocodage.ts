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
  /** Ce que le service a réellement localisé : le numéro, la rue entière ou un lieu approché. */
  precision: Precision;
}

export type Precision = 'numero' | 'rue' | 'lieu';

/** Numéro de voie saisi en tête de recherche (« 454 », « 12 bis »), ou null. */
export function numeroDemande(q: string): string | null {
  const m = /^\s*(\d{1,4})\s*(bis|ter|quater|[a-d])?(?=[\s,]|$)/i.exec(q);
  if (!m) return null;
  // Un code postal seul n'est pas un numéro de voie.
  if (/^\s*\d{5}\b/.test(q)) return null;
  return m[2] ? `${m[1]} ${m[2].toLowerCase()}` : m[1];
}

/** Si un numéro était demandé, les adresses qui le localisent vraiment passent en tête. */
export function trierParPrecision(q: string, adresses: Adresse[]): Adresse[] {
  if (!numeroDemande(q)) return adresses;
  return [...adresses.filter((a) => a.precision === 'numero'), ...adresses.filter((a) => a.precision !== 'numero')];
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

interface FeatureIGN {
  geometry: { coordinates: [number, number] };
  properties: ProprietesIGN;
}

export function adresseIGN(f: FeatureIGN): Adresse {
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  // Le service fournit x/y en Lambert 93 ; à défaut on projette nous-mêmes.
  const l93 = typeof p.x === 'number' && typeof p.y === 'number' && p.x > 0 ? { x: p.x, y: p.y } : versLambert93(lon, lat);
  const precision: Precision = p.type === 'housenumber' ? 'numero' : p.type === 'street' ? 'rue' : 'lieu';
  return { libelle: p.label ?? '', contexte: p.context ?? '', lon, lat, x: l93.x, y: l93.y, source: 'ign', precision };
}

async function chercherIGN(q: string, signal?: AbortSignal): Promise<Adresse[]> {
  const r = await avecDelai(`${URL_IGN}?q=${encodeURIComponent(q)}&autocomplete=1&index=address&limit=6`, 3500, signal);
  if (!r.ok) throw new Error(`IGN ${r.status}`);
  const geo = (await r.json()) as { features: FeatureIGN[] };
  return trierParPrecision(q, geo.features.map(adresseIGN));
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

interface FeaturePhoton {
  geometry: { coordinates: [number, number] };
  properties: ProprietesPhoton;
}

/** Convertit un résultat Photon ; null s'il est hors de France ou sans libellé exploitable. */
export function adressePhoton(f: FeaturePhoton): Adresse | null {
  const p = f.properties;
  if (p.countrycode && p.countrycode !== 'FR') return null;
  const [lon, lat] = f.geometry.coordinates;
  const voie = [p.housenumber, p.street ?? (p.type === 'street' ? p.name : undefined)].filter(Boolean).join(' ');
  const libelle = [voie || p.name, [p.postcode, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (!libelle) return null;
  const precision: Precision = p.housenumber ? 'numero' : p.type === 'street' ? 'rue' : 'lieu';
  const l93 = versLambert93(lon, lat);
  return { libelle, contexte: [p.district, p.state].filter(Boolean).join(', '), lon, lat, x: l93.x, y: l93.y, source: 'osm', precision };
}

async function chercherPhoton(q: string, signal?: AbortSignal): Promise<Adresse[]> {
  const url = `${URL_PHOTON}?q=${encodeURIComponent(q)}&lang=fr&limit=8&bbox=-5.5,41.2,9.8,51.3`;
  const r = await avecDelai(url, 6000, signal);
  if (!r.ok) throw new Error(`Photon ${r.status}`);
  const geo = (await r.json()) as { features: FeaturePhoton[] };
  const vus = new Set<string>();
  const resultats: Adresse[] = [];
  for (const f of geo.features) {
    const a = adressePhoton(f);
    if (!a || vus.has(a.libelle)) continue;
    vus.add(a.libelle);
    resultats.push(a);
  }
  return trierParPrecision(q, resultats).slice(0, 6);
}

const ERREUR_TOTALE = 'La recherche d’adresse est momentanément indisponible (services IGN et OpenStreetMap injoignables). Réessayez dans un instant.';

/**
 * Propositions d'adresses pour une saisie. L'IGN est interrogé d'abord ; s'il
 * n'a pas répondu au bout de 1,2 s, Photon est lancé en parallèle et le
 * premier résultat utilisable l'emporte. Lève une erreur si les deux échouent.
 */
export async function chercherAdresses(q: string, signal?: AbortSignal): Promise<Adresse[]> {
  const texte = q.trim();
  if (texte.length < 3) return [];
  if (Date.now() < ignIndisponibleJusqua) {
    try {
      return await chercherPhoton(texte, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Error(ERREUR_TOTALE, { cause: e });
    }
  }
  return new Promise<Adresse[]>((resoudre, rejeter) => {
    let fini = false;
    let echecs = 0;
    let photonLance = false;
    const reussir = (r: Adresse[]): void => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      resoudre(r);
    };
    const echouer = (e: unknown): void => {
      if (fini) return;
      if (signal?.aborted) {
        fini = true;
        clearTimeout(minuterie);
        rejeter(e);
        return;
      }
      echecs++;
      if (echecs >= 2) {
        fini = true;
        rejeter(new Error(ERREUR_TOTALE, { cause: e }));
      }
    };
    const lancerPhoton = (): void => {
      if (photonLance || fini) return;
      photonLance = true;
      chercherPhoton(texte, signal).then(reussir, echouer);
    };
    const minuterie = setTimeout(lancerPhoton, 1200);
    chercherIGN(texte, signal).then(reussir, (e) => {
      if (!signal?.aborted) ignIndisponibleJusqua = Date.now() + 60_000;
      lancerPhoton();
      echouer(e);
    });
  });
}
