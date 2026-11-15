/** Messages échangés entre l'interface et le moteur de calcul (Web Worker). */
import { type Arete, type Batiment, type ParametresEtages } from '../coeur/facades';
import { type Reglages, type ResultatFenetre, type SpecFenetre } from '../coeur/calcul';
import { type AnneauMaille } from './anneaux';
import { type InfoInventaire, type ModeRelief } from './scene';

export type Requete =
  | { type: 'charger'; x: number; y: number; etages: ParametresEtages }
  | { type: 'calculer'; fenetres: SpecFenetre[]; actif: number; reglages: Reglages; tous: boolean }
  | { type: 'maillage'; x: number; y: number; etendue: string }
  | { type: 'viderCache' };

export interface InfoScene {
  mode: ModeRelief;
  avertissements: string[];
  /** Inventaire des arbres de la ville utilisé ici, ou null. */
  inventaire: InfoInventaire | null;
  batiments: Batiment[];
  aretes: Arete[];
  /** Centre demandé (Lambert 93) et sa position géographique. */
  x: number;
  y: number;
  lon: number;
  lat: number;
  convergence: number;
  dureeMs: number;
  /** Nombre de ressources servies par le cache local. */
  depuisCache: number;
  telechargees: number;
}

export interface Cumul {
  heuresAn: number;
  moyenneHiver: number;
  moyenneEte: number;
  joursSansSoleil: number;
  heuresJour: Float32Array;
}

export interface ResultatCalcul {
  fenetres: ResultatFenetre[];
  /** Ensoleillement cumulé du logement (au moins une fenêtre au soleil), s'il y a plusieurs fenêtres. */
  cumul: Cumul | null;
  dureeMs: number;
}

export interface ResultatMaillage {
  /** Anneaux du plus fin (premier, au centre) au plus grossier. */
  anneaux: AnneauMaille[];
  /** Altitude (m NGF) correspondant à y = 0 dans la vue, et centre Lambert 93 de la vue. */
  z0: number;
  x: number;
  y: number;
  /** Rayon du détail fin (m), de toute la vue (m), et de la zone où la caméra peut se promener (m). */
  rayon: number;
  rayonTotal: number;
  rayonPromenade: number;
  etendue: string;
  /** Taille du maillage, pour l'information de l'utilisateur. */
  triangles: number;
}

export type Reponse =
  | { id: number; ok: true; resultat: unknown }
  | { id: number; ok: false; message: string; statut: number | null }
  | { id: -1; progression: string };
