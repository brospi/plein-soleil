/**
 * Worker du nuage de points : index des dalles, lecture des fichiers COPC
 * par plages d'octets et décodage LAZ (WebAssembly), hors du fil de l'interface.
 *
 * Le service de téléchargement de l'IGN répond 429 au-delà d'une dizaine de
 * requêtes par seconde : on en lance au plus 6 par seconde, 4 à la fois.
 */
import { createLazPerf } from 'laz-perf/lib/worker/index.js';
import urlWasm from 'laz-perf/lib/worker/laz-perf.wasm?url';
import { TAILLE_ENTETE, type DecodeurLaz, decompresser, extrairePoints, lireEntete, lireHierarchie } from '../donnees/copc';
import { urlDallesNuage } from '../donnees/ign';
import { FACTEUR_MAX, choisirNoeuds, couleursPoints, lireIndexDalles, positionsVue, utile, type DalleNuage, type NoeudChoisi } from './nuage';
import { type MessageNuage, type RequeteNuage } from './protocole-nuage';

const CONCURRENCE = 4;
const INTERVALLE_MS = 170;

const envoyer = (m: MessageNuage, transfert: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, transfert);

/* ---------- Débit des requêtes ---------- */
let actives = 0;
let dernierDepart = 0;
const enAttente: (() => void)[] = [];

function libererPlace(): void {
  const maintenant = performance.now();
  if (!enAttente.length || actives >= CONCURRENCE) return;
  const attente = dernierDepart + INTERVALLE_MS - maintenant;
  if (attente > 0) {
    setTimeout(libererPlace, attente);
    return;
  }
  actives++;
  dernierDepart = maintenant;
  enAttente.shift()!();
  if (enAttente.length) setTimeout(libererPlace, INTERVALLE_MS);
}

function prendrePlace(): Promise<void> {
  return new Promise((ok) => {
    enAttente.push(ok);
    libererPlace();
  });
}

function rendrePlace(): void {
  actives--;
  libererPlace();
}

const pause = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

class ErreurNuage extends Error {}

/** Lit `taille` octets à partir de `debut`, en relançant sur limite de débit et erreurs passagères. */
async function plage(url: string, debut: number, taille: number): Promise<Uint8Array> {
  let statut: number | null = null;
  for (let essai = 0; essai < 6; essai++) {
    await prendrePlace();
    let r: Response | null = null;
    const garde = new AbortController();
    try {
      r = await fetch(url, { headers: { Range: `bytes=${debut}-${debut + taille - 1}` }, signal: garde.signal });
      statut = r.status;
      if (r.status === 206) {
        const octets = new Uint8Array(await r.arrayBuffer());
        if (octets.length === taille) return octets;
      } else if (r.status === 200) {
        // Le serveur ignorerait la plage : on n'avale pas le fichier entier.
        garde.abort();
        throw new ErreurNuage('Le service de l’IGN ne permet pas de lire ce nuage de points par morceaux.');
      } else if (r.status !== 429 && r.status < 500) {
        throw new ErreurNuage(`Le nuage de points LiDAR HD n’a pas pu être téléchargé (erreur ${r.status}).`);
      }
    } catch (e) {
      if (e instanceof ErreurNuage) throw e;
      statut = null;
    } finally {
      rendrePlace();
    }
    const retard = Number(r?.headers.get('Retry-After'));
    await pause(retard > 0 ? retard * 1000 : 1200 * 2 ** essai);
  }
  throw new ErreurNuage(
    statut === 429
      ? 'Le service de téléchargement de l’IGN limite le débit (erreur 429). Réessayez dans une minute.'
      : 'Le nuage de points LiDAR HD n’a pas pu être téléchargé. Vérifiez votre connexion.',
  );
}

/* ---------- Dalles ---------- */
const index = new Map<string, Promise<string[]>>();
const dalles = new Map<string, Promise<DalleNuage>>();

/** Dalles qui recouvrent la zone ; la requête est calée sur le kilomètre pour resservir l'index. */
function dallesZone(x: number, y: number, rayon: number): Promise<string[]> {
  const x0 = Math.floor((x - rayon) / 1000) * 1000 + 1;
  const y0 = Math.floor((y - rayon) / 1000) * 1000 + 1;
  const x1 = Math.ceil((x + rayon) / 1000) * 1000 - 1;
  const y1 = Math.ceil((y + rayon) / 1000) * 1000 - 1;
  const cle = `${x0},${y0},${x1},${y1}`;
  let p = index.get(cle);
  if (!p) {
    p = (async () => {
      for (let essai = 0; ; essai++) {
        try {
          const r = await fetch(urlDallesNuage(x0, y0, x1, y1));
          if (r.ok) return lireIndexDalles(await r.json(), { x0, y0, x1, y1 });
          if (r.status !== 429 && r.status < 500) throw new ErreurNuage(`L’index des nuages de points de l’IGN est indisponible (erreur ${r.status}).`);
        } catch (e) {
          if (e instanceof ErreurNuage || essai >= 3) throw e instanceof ErreurNuage ? e : new ErreurNuage('L’index des nuages de points de l’IGN est injoignable.');
        }
        await pause(1500 * 2 ** essai);
      }
    })();
    p.catch(() => index.delete(cle));
    index.set(cle, p);
  }
  return p;
}

function dalle(url: string): Promise<DalleNuage> {
  let p = dalles.get(url);
  if (!p) {
    p = (async () => {
      const entete = lireEntete(await plage(url, 0, TAILLE_ENTETE));
      const noeuds = lireHierarchie(await plage(url, entete.pageRacine.position, entete.pageRacine.taille));
      return { url, entete, noeuds };
    })();
    p.catch(() => dalles.delete(url));
    dalles.set(url, p);
  }
  return p;
}

/** Lit les pages de hiérarchie secondaires utiles autour du centre (les grandes dalles en ont). */
async function completerHierarchie(d: DalleNuage, x: number, y: number, rayon: number): Promise<void> {
  for (;;) {
    const pages = d.noeuds.filter((n) => n.points === -1 && utile(d.entete, n, x, y, rayon, FACTEUR_MAX).ok);
    if (!pages.length) return;
    for (const p of pages) {
      const enfants = lireHierarchie(await plage(d.url, p.position, p.taille));
      p.points = -2; // page lue
      d.noeuds.push(...enfants);
    }
  }
}

/* ---------- Décodeur ---------- */
let decodeur: Promise<DecodeurLaz> | null = null;
function laz(): Promise<DecodeurLaz> {
  decodeur ??= createLazPerf({ locateFile: () => urlWasm }) as unknown as Promise<DecodeurLaz>;
  return decodeur;
}

/* ---------- Zone demandée ---------- */
let zoneCourante = 0;
let voulus = new Set<string>();
const enCours = new Set<string>();

async function chargerNoeud(c: NoeudChoisi, d: DalleNuage, zone: number): Promise<void> {
  if (!voulus.has(c.cle) || enCours.has(c.cle)) return;
  enCours.add(c.cle);
  try {
    const bloc = await plage(d.url, c.noeud.position, c.noeud.taille);
    if (!voulus.has(c.cle)) return;
    const brut = decompresser(await laz(), bloc, d.entete, c.noeud.points);
    const origine = { x: d.entete.min[0], y: d.entete.min[1] };
    const p = extrairePoints(brut, d.entete, origine);
    const positions = positionsVue(p);
    const couleurs = couleursPoints(p);
    envoyer({ type: 'noeud', zone, cle: c.cle, origine, niveau: c.noeud.d, positions, couleurs }, [positions.buffer, couleurs.buffer]);
  } finally {
    enCours.delete(c.cle);
  }
}

async function zone(r: Extract<RequeteNuage, { type: 'zone' }>): Promise<void> {
  const id = r.zone;
  zoneCourante = id;
  const urls = await dallesZone(r.x, r.y, r.rayon);
  if (id !== zoneCourante) return;
  if (!urls.length) {
    voulus = new Set();
    envoyer({ type: 'selection', zone: id, cles: [], points: 0, facteur: FACTEUR_MAX, dalles: 0 });
    envoyer({ type: 'fin', zone: id });
    return;
  }
  const liste = await Promise.all(urls.map(dalle));
  await Promise.all(liste.map((d) => completerHierarchie(d, r.x, r.y, r.rayon)));
  if (id !== zoneCourante) return;
  const s = choisirNoeuds(liste, r.x, r.y, r.rayon, r.budget);
  voulus = new Set(s.choix.map((c) => c.cle));
  envoyer({ type: 'selection', zone: id, cles: [...voulus], points: s.points, facteur: s.facteur, dalles: liste.length });
  const presents = new Set(r.presents);
  const parUrl = new Map(liste.map((d) => [d.url, d]));
  const file = s.choix.filter((c) => !presents.has(c.cle));
  let erreur: unknown = null;
  // Les nœuds partent dans l'ordre : grossiers d'abord, proches d'abord.
  await Promise.all(
    Array.from({ length: CONCURRENCE }, async () => {
      for (let c = file.shift(); c; c = file.shift()) {
        if (id !== zoneCourante && !voulus.has(c.cle)) continue;
        try {
          await chargerNoeud(c, parUrl.get(c.url)!, id);
        } catch (e) {
          erreur ??= e;
        }
      }
    }),
  );
  if (id !== zoneCourante) return;
  if (erreur) throw erreur;
  envoyer({ type: 'fin', zone: id });
}

self.onmessage = (ev: MessageEvent<RequeteNuage>) => {
  const r = ev.data;
  if (r.type === 'zone') {
    zone(r).catch((e: unknown) => {
      if (r.zone !== zoneCourante) return;
      envoyer({ type: 'erreur', zone: r.zone, message: e instanceof ErreurNuage ? e.message : `Le nuage de points n’a pas pu être lu : ${(e as Error).message}` });
    });
  } else if (r.type === 'arreter') {
    zoneCourante = -1;
    voulus = new Set();
  }
};
