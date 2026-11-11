/**
 * Requêtes HTTP avec relances espacées et messages d'erreur précis.
 * Les services de l'IGN répondent parfois 429 (limite de débit) ou 502/503/504.
 */

export class ErreurReseau extends Error {
  constructor(
    message: string,
    public service: string,
    public statut: number | null,
  ) {
    super(message);
    this.name = 'ErreurReseau';
  }
}

export interface Attente {
  service: string;
  statut: number | null;
  essai: number;
  delaiMs: number;
}

export interface OptionsRequete {
  /** Nom du service, pour les messages (« altimétrie LiDAR HD », « BD TOPO »…). */
  service: string;
  essais?: number;
  delaiMaxMs?: number;
  /** Durée maximale d'une tentative avant abandon et relance (ms). */
  expirationMs?: number;
  signal?: AbortSignal;
  surAttente?: (a: Attente) => void;
}

const DELAIS = [1200, 3000, 7000, 12000];

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Requête annulée', 'AbortError'));
    });
  });
}

export function messageStatut(service: string, statut: number | null): string {
  if (statut === 429) return `Le service ${service} limite le débit des requêtes (erreur 429). Réessayez dans une minute.`;
  if (statut === 504 || statut === 502 || statut === 503)
    return `Le service ${service} est momentanément indisponible (erreur ${statut}). Réessayez dans quelques minutes.`;
  if (statut === null) return `Impossible de joindre le service ${service}. Vérifiez votre connexion Internet.`;
  return `Le service ${service} a renvoyé une erreur inattendue (${statut}).`;
}

/** Récupère une ressource en relançant sur 429, 5xx et erreurs réseau. */
export async function requete(url: string, o: OptionsRequete): Promise<Response> {
  const essais = o.essais ?? 4;
  let dernierStatut: number | null = null;
  for (let essai = 1; essai <= essais; essai++) {
    // Une requête restée sans réponse est abandonnée puis relancée.
    const garde = new AbortController();
    const minuterie = setTimeout(() => garde.abort(), o.expirationMs ?? 20_000);
    const annuler = (): void => garde.abort();
    o.signal?.addEventListener('abort', annuler);
    try {
      const r = await fetch(url, { signal: garde.signal });
      if (r.ok) return new Response(await r.arrayBuffer(), { status: r.status, headers: r.headers });
      dernierStatut = r.status;
      if (r.status !== 429 && r.status < 500) break; // erreur définitive (400, 404…)
      if (essai < essais) {
        const retryAfter = Number(r.headers.get('Retry-After'));
        const delaiMs = Math.min(o.delaiMaxMs ?? 15000, retryAfter > 0 ? retryAfter * 1000 : DELAIS[essai - 1] ?? 12000);
        o.surAttente?.({ service: o.service, statut: r.status, essai, delaiMs });
        await pause(delaiMs, o.signal);
      }
    } catch (e) {
      if (o.signal?.aborted) throw e;
      dernierStatut = null;
      if (essai < essais) {
        const delaiMs = DELAIS[essai - 1] ?? 12000;
        o.surAttente?.({ service: o.service, statut: null, essai, delaiMs });
        await pause(delaiMs, o.signal);
      }
    } finally {
      clearTimeout(minuterie);
      o.signal?.removeEventListener('abort', annuler);
    }
  }
  throw new ErreurReseau(messageStatut(o.service, dernierStatut), o.service, dernierStatut);
}

/**
 * JSON avec relance si la réponse n'en est pas (le WFS de l'IGN renvoie
 * parfois, avec un code 200, une page technique à la place des données).
 */
export async function requeteJson(url: string, o: OptionsRequete): Promise<unknown> {
  const essais = o.essais ?? 4;
  for (let essai = 1; ; essai++) {
    const r = await requete(url, o);
    const texte = await r.text();
    try {
      return JSON.parse(texte);
    } catch {
      if (essai >= essais) {
        throw new ErreurReseau(`Le service ${o.service} a renvoyé une réponse illisible. Réessayez dans quelques minutes.`, o.service, r.status);
      }
      const delaiMs = DELAIS[essai - 1] ?? 12000;
      o.surAttente?.({ service: o.service, statut: r.status, essai, delaiMs });
      await pause(delaiMs, o.signal);
    }
  }
}

/** Données binaires dont on vérifie le type (le WMS signale ses erreurs en XML avec un code 200 ou 400). */
export async function requeteBinaire(url: string, o: OptionsRequete, typeAttendu: string): Promise<ArrayBuffer> {
  const essais = o.essais ?? 4;
  for (let essai = 1; ; essai++) {
    const r = await requete(url, o);
    const type = r.headers.get('Content-Type') ?? '';
    if (type.toLowerCase().startsWith(typeAttendu)) return r.arrayBuffer();
    if (essai >= essais) {
      throw new ErreurReseau(`Le service ${o.service} a renvoyé une réponse inattendue (${type || 'type inconnu'}). Réessayez dans quelques minutes.`, o.service, r.status);
    }
    const delaiMs = DELAIS[essai - 1] ?? 12000;
    o.surAttente?.({ service: o.service, statut: r.status, essai, delaiMs });
    await pause(delaiMs, o.signal);
  }
}
