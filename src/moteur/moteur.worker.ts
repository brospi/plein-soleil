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
import { coutAnneaux, etendue, maillerAnneaux, rayonPromenade } from './anneaux';
import { valeurLisse } from '../coeur/raster';
import { areteLaPlusProche } from '../coeur/facades';

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

async function avecCache(url: string, service: string, type: string, facultatif = false): Promise<ArrayBuffer> {
  const connu = await cache.lire(url);
  if (connu) {
    depuisCache++;
    return connu;
  }
  // Couche facultative : deux essais de 8 s au plus, puis le calcul continue sans elle.
  const options = facultatif ? { service, surAttente, essais: 2, expirationMs: 8000 } : { service, surAttente };
  const tampon = await requeteBinaire(url, options, type);
  telechargees++;
  void cache.ecrire(url, tampon);
  return tampon;
}

const acces: Acces = {
  binaire: (url, service, facultatif) => avecCache(url, service, 'image/x-bil', facultatif),
  image: async (url, _l, _h, service, facultatif) => (await decoderPng(await avecCache(url, service, 'image/png', facultatif))).rgba,
  json: (url, service, facultatif) => requeteJson(url, facultatif ? { service, surAttente, essais: 2, expirationMs: 8000 } : { service, surAttente }),
};

let scene: SceneChargee | null = null;
let calculateur: Calculateur | null = null;
let table: TableSolaire | null = null;
let cleTable = '';
let numeroChargement = 0;

async function charger(r: Extract<Requete, { type: 'charger' }>): Promise<InfoScene> {
  const t0 = performance.now();
  depuisCache = 0;
  telechargees = 0;
  // La scène précédente reste utilisable pendant le téléchargement ; si une demande plus
  // récente arrive entre-temps, celle-ci est abandonnée pour ne pas l'écraser.
  const moi = ++numeroChargement;
  const s = await chargerScene(r.x, r.y, acces, r.etages, (m) => moi === numeroChargement && envoyer({ id: -1, progression: m }));
  if (moi !== numeroChargement) throw new Error('Chargement remplacé par une demande plus récente.');
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
    inventaire: s.inventaire,
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
  // Chaque fenêtre est rattachée à son bâtiment pour connaître son nombre de niveaux (BD TOPO).
  const aretes = scene?.aretes ?? [];
  const batiments = scene?.batiments ?? [];
  const fenetres = r.fenetres.map((f, i) => {
    const mur = areteLaPlusProche(aretes, f.x, f.y, 1, (a) => a.nx * f.nx + a.ny * f.ny > 0.9);
    const batiment = mur ? batiments[mur.arete.bat] : undefined;
    return calculateur!.calculer({ ...f, niveauxConnus: batiment?.etages ?? null, hauteurConnue: batiment?.hauteur ?? null }, r.reglages, i === r.actif && r.tous);
  });
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

function mailler(r: Extract<Requete, { type: 'maillage' }>): { resultat: ResultatMaillage; transfert: Transferable[] } {
  if (!scene) throw new Error('Aucune adresse chargée.');
  const z0 = valeurLisse(scene.relief.mnt, r.x, r.y, 0);
  const e = etendue(r.etendue);
  const anneaux = maillerAnneaux(scene.niveaux, [scene.classes, scene.classesMoyen, null], r.x, r.y, z0, e.anneaux);
  if (!anneaux.length) throw new Error('Le relief de cette zone n’a pas pu être maillé.');
  const transfert: Transferable[] = [];
  for (const a of anneaux) {
    const m = a.maillage;
    transfert.push(m.positions.buffer, m.normales.buffer, m.couleurs.buffer, m.indicesToits.buffer, m.indicesMurs.buffer);
  }
  return {
    resultat: {
      anneaux,
      z0,
      x: r.x,
      y: r.y,
      rayon: anneaux[0].rayon,
      rayonTotal: anneaux[anneaux.length - 1].rayon,
      rayonPromenade: rayonPromenade(e.anneaux, scene.niveaux.map((n) => n.dur)),
      etendue: e.id,
      triangles: coutAnneaux(anneaux).triangles,
    },
    transfert,
  };
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
