/**
 * État d'un logement étudié, et son encodage dans l'URL (partage) et dans le
 * stockage local (comparateur).
 */
import { type Reglages, type SpecFenetre, REGLAGES_DEFAUT } from '../coeur/calcul';
import { FENETRE_DEFAUT } from '../coeur/fenetre';
import { type ModeArbres } from '../coeur/simulation';

export interface FenetreEtat {
  x: number;
  y: number;
  /** Azimut « grille » de la normale extérieure (degrés). */
  az: number;
  etage: number;
  hauteurLibre: number | null;
  largeur: number;
  hauteur: number;
  embrasure: number;
  balcon: boolean;
  balconProfondeur: number;
  balconDegagement: number;
}

export interface AdresseEtat {
  libelle: string;
  x: number;
  y: number;
}

export interface EtatLogement {
  adresse: AdresseEtat | null;
  fenetres: FenetreEtat[];
  actif: number;
  reglages: Reglages;
}

export function etatInitial(): EtatLogement {
  return { adresse: null, fenetres: [], actif: 0, reglages: { ...REGLAGES_DEFAUT } };
}

export function nouvelleFenetre(x: number, y: number, az: number, etage: number, modele?: FenetreEtat): FenetreEtat {
  return {
    x,
    y,
    az,
    etage,
    hauteurLibre: null,
    largeur: modele?.largeur ?? FENETRE_DEFAUT.largeur,
    hauteur: modele?.hauteur ?? FENETRE_DEFAUT.hauteur,
    embrasure: modele?.embrasure ?? FENETRE_DEFAUT.embrasure,
    balcon: modele?.balcon ?? false,
    balconProfondeur: modele?.balconProfondeur ?? 1.2,
    balconDegagement: modele?.balconDegagement ?? 0.5,
  };
}

export function versSpec(f: FenetreEtat, altitude: number | null = null): SpecFenetre {
  const a = (f.az * Math.PI) / 180;
  return {
    x: f.x,
    y: f.y,
    nx: Math.sin(a),
    ny: Math.cos(a),
    etage: f.etage,
    hauteurLibre: f.hauteurLibre,
    altitude,
    geometrie: {
      largeur: f.largeur,
      hauteur: f.hauteur,
      embrasure: f.embrasure,
      balcon: f.balcon ? { profondeur: f.balconProfondeur, degagement: f.balconDegagement } : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Encodage compact                                                    */
/* ------------------------------------------------------------------ */

const arrondi = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

function base64url(texte: string): string {
  const octets = new TextEncoder().encode(texte);
  let binaire = '';
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function depuisBase64url(code: string): string {
  const binaire = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const octets = Uint8Array.from(binaire, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(octets);
}

/** Sérialise l'état complet (adresse, fenêtres, réglages) en une chaîne sûre pour une URL. */
export function encoderEtat(e: EtatLogement): string {
  const r = e.reglages;
  const compact = {
    v: 1,
    a: e.adresse ? [e.adresse.libelle, arrondi(e.adresse.x, 1), arrondi(e.adresse.y, 1)] : null,
    r: [r.hauteurEtage, r.allege, r.arbres, r.transmissionHiver, r.troubleLinke, r.hauteurEtageAuto ? 1 : 0],
    i: e.actif,
    f: e.fenetres.map((f) => [
      arrondi(f.x),
      arrondi(f.y),
      arrondi(f.az),
      f.etage,
      f.hauteurLibre === null ? -1 : arrondi(f.hauteurLibre),
      f.largeur,
      f.hauteur,
      f.embrasure,
      f.balcon ? 1 : 0,
      f.balconProfondeur,
      f.balconDegagement,
    ]),
  };
  return base64url(JSON.stringify(compact));
}

const nombreValide = (v: unknown, min: number, max: number, defaut: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : defaut;

/** Reconstruit un état depuis l'URL ; renvoie null si le code est invalide. */
export function decoderEtat(code: string): EtatLogement | null {
  try {
    const c = JSON.parse(depuisBase64url(code)) as { v: number; a: unknown[] | null; r: unknown[]; i: number; f: unknown[][] };
    if (c.v !== 1 || !Array.isArray(c.r) || !Array.isArray(c.f)) return null;
    const e = etatInitial();
    if (Array.isArray(c.a) && typeof c.a[0] === 'string' && typeof c.a[1] === 'number' && typeof c.a[2] === 'number') {
      e.adresse = { libelle: c.a[0].slice(0, 200), x: c.a[1], y: c.a[2] };
    }
    e.reglages = {
      hauteurEtage: nombreValide(c.r[0], 2.2, 5, REGLAGES_DEFAUT.hauteurEtage),
      // Les liens créés avant le calage automatique gardent leur hauteur d'étage fixe : mêmes résultats qu'à l'époque.
      hauteurEtageAuto: c.r[5] === 1,
      allege: nombreValide(c.r[1], 0, 2, REGLAGES_DEFAUT.allege),
      arbres: nombreValide(c.r[2], 0, 2, REGLAGES_DEFAUT.arbres) as ModeArbres,
      transmissionHiver: nombreValide(c.r[3], 0, 1, REGLAGES_DEFAUT.transmissionHiver),
      troubleLinke: nombreValide(c.r[4], 1.5, 7, REGLAGES_DEFAUT.troubleLinke),
    };
    e.fenetres = c.f
      .filter((f) => Array.isArray(f) && typeof f[0] === 'number' && typeof f[1] === 'number')
      .slice(0, 6)
      .map((f) => ({
        x: f[0] as number,
        y: f[1] as number,
        az: nombreValide(f[2], 0, 360, 180),
        etage: Math.round(nombreValide(f[3], 0, 60, 0)),
        hauteurLibre: typeof f[4] === 'number' && f[4] >= 0 ? Math.min(f[4], 200) : null,
        largeur: nombreValide(f[5], 0.3, 8, FENETRE_DEFAUT.largeur),
        hauteur: nombreValide(f[6], 0.3, 4, FENETRE_DEFAUT.hauteur),
        embrasure: nombreValide(f[7], 0, 1, FENETRE_DEFAUT.embrasure),
        balcon: f[8] === 1,
        balconProfondeur: nombreValide(f[9], 0.2, 4, 1.2),
        balconDegagement: nombreValide(f[10], 0, 3, 0.5),
      }));
    e.actif = Math.max(0, Math.min(e.fenetres.length - 1, Math.round(nombreValide(c.i, 0, 10, 0))));
    return e;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Comparateur (stockage local)                                        */
/* ------------------------------------------------------------------ */

export interface LogementEnregistre {
  id: string;
  titre: string;
  sousTitre: string;
  /** État encodé, pour rouvrir le logement. */
  code: string;
  heuresAn: number;
  moyenneHiver: number;
  moyenneEte: number;
  joursSansSoleil: number;
  partDuMaximum: number;
  energieAn: number;
  cielVisible: number;
  /** Moyenne hebdomadaire des heures de soleil par jour (52 valeurs). */
  semaines: number[];
  indicatif: boolean;
}

const CLE_COMPARATEUR = 'plein-soleil:comparateur';
export const MAX_LOGEMENTS = 4;

export function lireComparateur(): LogementEnregistre[] {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_COMPARATEUR) ?? '[]') as LogementEnregistre[];
    return Array.isArray(brut) ? brut.filter((l) => l && typeof l.code === 'string').slice(0, MAX_LOGEMENTS) : [];
  } catch {
    return [];
  }
}

export function ecrireComparateur(liste: LogementEnregistre[]): boolean {
  try {
    localStorage.setItem(CLE_COMPARATEUR, JSON.stringify(liste.slice(0, MAX_LOGEMENTS)));
    return true;
  } catch {
    return false;
  }
}
