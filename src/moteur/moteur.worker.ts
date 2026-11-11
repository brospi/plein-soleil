/// <reference lib="webworker" />
/**
 * Moteur de calcul : s'exécute dans un Web Worker pour ne jamais bloquer
 * l'interface. Il télécharge les données, les met en cache et calcule.
 */
import { type Acces, type SceneChargee, chargerScene } from './scene';
import { type Cumul, type InfoScene, type Reponse, type Requete, type ResultatCalcul, type ResultatMaillage } from './protocole';
import { ErreurReseau, requeteBinaire, requeteJson, type Attente } from '../donnees/reseau';
import * as cache from '../donnees/cache';
import { decoderPng } from '../donnees/png';
import { Calculateur } from '../coeur/calcul';
import { tableSolaire, type TableSolaire } from '../coeur/soleil';
import { convergenceMeridiens, depuisLambert93 } from '../coeur/lambert93';
import { Etat } from '../coeur/simulation';
import { maillerRelief } from '../coeur/maillage';
import { type Raster, valeurLisse } from '../coeur/raster';
import { Classe } from '../coeur/classification';

const moi = self as unknown as DedicatedWorkerGlobalScope;

function envoyer(r: Reponse, transfert: Transferable[] = []): void {
  moi.postMessage(r, transfert);
}

let depuisCache = 0;
let telechargees = 0;

function surAttente(a: Attente): void {
  const cause = a.statut === 429 ? 'limite de débit atteinte' : a.statut ? `erreur ${a.statut}` : 'connexion interrompue';
  envoyer({ id: -1, progression: `Service ${a.service} : ${cause}. Nouvelle tentative dans ${Math.round(a.delaiMs / 1000)} s (essai ${a.essai + 1})…` });
}

async function avecCache(url: string, service: string, type: string): Promise<ArrayBuffer> {
  const connu = await cache.lire(url);
  if (connu) {
    depuisCache++;
    return connu;
  }
  const tampon = await requeteBinaire(url, { service, surAttente }, type);
  telechargees++;
  void cache.ecrire(url, tampon);
  return tampon;
}

const acces: Acces = {
  binaire: (url, service) => avecCache(url, service, 'image/x-bil'),
  image: async (url, _l, _h, service) => (await decoderPng(await avecCache(url, service, 'image/png'))).rgba,
  json: (url, service) => requeteJson(url, { service, surAttente }),
};

let scene: SceneChargee | null = null;
let calculateur: Calculateur | null = null;
let table: TableSolaire | null = null;
let cleTable = '';

async function charger(r: Extract<Requete, { type: 'charger' }>): Promise<InfoScene> {
  const t0 = performance.now();
  depuisCache = 0;
  telechargees = 0;
  scene = null;
  calculateur = null;
  const s = await chargerScene(r.x, r.y, acces, r.etages, (m) => envoyer({ id: -1, progression: m }));
  const geo = depuisLambert93(r.x, r.y);
  const cle = `${geo.lat.toFixed(2)}|${geo.lon.toFixed(2)}`;
  if (!table || cle !== cleTable) {
    table = tableSolaire(geo.lat, geo.lon);
    cleTable = cle;
  }
  const convergence = convergenceMeridiens(geo.lon);
  scene = s;
  calculateur = new Calculateur({ niveaux: s.niveaux, relief: s.relief, table, convergence });
  return {
    mode: s.mode,
    avertissements: s.avertissements,
    batiments: s.batiments,
    aretes: s.aretes,
    x: r.x,
    y: r.y,
    lon: geo.lon,
    lat: geo.lat,
    convergence,
    dureeMs: performance.now() - t0,
    depuisCache,
    telechargees,
  };
}

function calculer(r: Extract<Requete, { type: 'calculer' }>): { resultat: ResultatCalcul; transfert: Transferable[] } {
  if (!calculateur) throw new Error('Aucune adresse chargée.');
  const t0 = performance.now();
  const fenetres = r.fenetres.map((f, i) => calculateur!.calculer(f, r.reglages, i === r.actif && r.tous));
  let cumul: Cumul | null = null;
  const details = fenetres.map((f) => f.detail).filter((d) => d !== null);
  if (fenetres.length > 1 && details.length > 0) {
    const jours = details[0].heuresJour.length;
    const creneaux = details[0].etats!.length / jours;
    const dt = 24 / creneaux;
    const heuresJour = new Float32Array(jours);
    let sans = 0;
    for (let j = 0; j < jours; j++) {
      let n = 0;
      for (let c = 0; c < creneaux; c++) {
        const i = j * creneaux + c;
        for (const d of details) {
          const e = d.etats![i];
          if (e === Etat.SoleilPartiel || e === Etat.SoleilPlein) {
            n++;
            break;
          }
        }
      }
      heuresJour[j] = n * dt;
      if (n === 0) sans++;
    }
    const somme = (a: number, b: number): number => {
      let s = 0;
      for (let i = a; i < b; i++) s += heuresJour[i];
      return s;
    };
    cumul = {
      heuresAn: somme(0, jours),
      moyenneHiver: (somme(0, 59) + somme(334, 365)) / 90,
      moyenneEte: somme(151, 243) / 92,
      joursSansSoleil: sans,
      heuresJour,
    };
  }
  // Seul le détail de la fenêtre active voyage avec ses tableaux par créneau.
  const transfert: Transferable[] = [];
  fenetres.forEach((f, i) => {
    if (!f.detail) return;
    if (i !== r.actif) {
      f.detail.etats = null;
      f.detail.fractions = null;
    } else {
      transfert.push(f.detail.etats!.buffer, f.detail.fractions!.buffer);
    }
  });
  return { resultat: { fenetres, cumul, dureeMs: performance.now() - t0 }, transfert };
}

/** Extrait un carré de cellules d'un niveau (surface visible : canopée ou bâti). */
function extraire(dur: Raster, arbres: Raster | null, classes: Uint8Array | null, x: number, y: number, rayon: number) {
  const c0 = Math.max(0, Math.floor((x - rayon - dur.x0) / dur.pas));
  const c1 = Math.min(dur.largeur, Math.ceil((x + rayon - dur.x0) / dur.pas));
  const l0 = Math.max(0, Math.floor((dur.y1 - (y + rayon)) / dur.pas));
  const l1 = Math.min(dur.hauteur, Math.ceil((dur.y1 - (y - rayon)) / dur.pas));
  const largeur = Math.max(0, c1 - c0);
  const hauteur = Math.max(0, l1 - l0);
  const h = new Float32Array(largeur * hauteur);
  const cl = new Uint8Array(largeur * hauteur);
  for (let l = 0; l < hauteur; l++) {
    for (let c = 0; c < largeur; c++) {
      const i = (l + l0) * dur.largeur + (c + c0);
      const a = arbres ? arbres.d[i] : -9999;
      const o = l * largeur + c;
      if (a > -1000) {
        h[o] = a;
        cl[o] = Classe.Vegetation;
      } else {
        h[o] = Math.max(dur.d[i], -100);
        cl[o] = classes ? (classes[i] === Classe.Vegetation ? Classe.Sol : classes[i]) : Classe.Sol;
      }
    }
  }
  // Position du centre de la cellule (0, 0) dans le repère de la vue (x est, z sud).
  const ox = dur.x0 + (c0 + 0.5) * dur.pas - x;
  const oz = y - (dur.y1 - (l0 + 0.5) * dur.pas);
  return { h, cl, largeur, hauteur, ox, oz, c0, l0 };
}

function mailler(r: Extract<Requete, { type: 'maillage' }>): { resultat: ResultatMaillage; transfert: Transferable[] } {
  if (!scene) throw new Error('Aucune adresse chargée.');
  const z0 = valeurLisse(scene.relief.mnt, r.x, r.y, 0);
  const n0 = scene.niveaux[0];
  const e = extraire(n0.dur, n0.arbres, scene.classes, r.x, r.y, r.rayon);
  const proche = maillerRelief(e.h, e.cl, e.largeur, e.hauteur, n0.dur.pas, { seuil: 1.2, ox: e.ox, oz: e.oz, z0 });
  let lointain = null;
  const n1 = scene.niveaux[1];
  if (n1 && r.rayonLointain > r.rayon) {
    const f = extraire(n1.dur, n1.arbres, scene.classesMoyen, r.x, r.y, r.rayonLointain);
    // Cellules du niveau moyen entièrement couvertes par le maillage fin.
    const pas = n1.dur.pas;
    const xMin = e.ox + 0.5;
    const xMax = e.ox + (e.largeur - 1) * n0.dur.pas - 0.5;
    const zMin = e.oz + 0.5;
    const zMax = e.oz + (e.hauteur - 1) * n0.dur.pas - 0.5;
    const exclure = {
      c0: Math.ceil((xMin - f.ox) / pas),
      c1: Math.floor((xMax - f.ox) / pas),
      l0: Math.ceil((zMin - f.oz) / pas),
      l1: Math.floor((zMax - f.oz) / pas),
    };
    lointain = maillerRelief(f.h, f.cl, f.largeur, f.hauteur, pas, { seuil: 3, ox: f.ox, oz: f.oz, z0, exclure });
  }
  const transfert: Transferable[] = [proche.positions.buffer, proche.normales.buffer, proche.couleurs.buffer, proche.indicesToits.buffer, proche.indicesMurs.buffer];
  if (lointain) transfert.push(lointain.positions.buffer, lointain.normales.buffer, lointain.couleurs.buffer, lointain.indicesToits.buffer, lointain.indicesMurs.buffer);
  return { resultat: { proche, lointain, z0, x: r.x, y: r.y, rayon: r.rayon, rayonLointain: r.rayonLointain }, transfert };
}

moi.onmessage = async (ev: MessageEvent<{ id: number; requete: Requete }>) => {
  const { id, requete } = ev.data;
  try {
    switch (requete.type) {
      case 'charger':
        envoyer({ id, ok: true, resultat: await charger(requete) });
        break;
      case 'calculer': {
        const { resultat, transfert } = calculer(requete);
        envoyer({ id, ok: true, resultat }, transfert);
        break;
      }
      case 'maillage': {
        const { resultat, transfert } = mailler(requete);
        envoyer({ id, ok: true, resultat }, transfert);
        break;
      }
      case 'viderCache':
        await cache.vider();
        envoyer({ id, ok: true, resultat: null });
        break;
    }
  } catch (e) {
    const err = e as Error;
    envoyer({ id, ok: false, message: err.message || 'Erreur inattendue pendant le calcul.', statut: err instanceof ErreurReseau ? err.statut : null });
  }
};
