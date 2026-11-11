/**
 * Position du soleil — algorithme NOAA (Solar Calculator, d'après J. Meeus,
 * « Astronomical Algorithms »). Précision ≈ 0,01° à 0,03° entre 1950 et 2050,
 * largement suffisante devant la résolution du masque d'horizon (0,25°).
 *
 * Conventions : azimut en degrés depuis le nord géographique, sens horaire
 * (est = 90°). Hauteur apparente en degrés, réfraction atmosphérique incluse.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Année type utilisée pour toutes les simulations (non bissextile). */
export const ANNEE_TYPE = 2026;
/** Pas de temps de la simulation annuelle, en minutes. */
export const PAS_MINUTES = 2;
export const CRENEAUX_PAR_JOUR = (24 * 60) / PAS_MINUTES;
export const JOURS = 365;

export interface PositionSoleil {
  /** Azimut géographique, degrés depuis le nord, sens horaire. */
  azimut: number;
  /** Hauteur apparente (réfraction incluse), degrés. */
  hauteur: number;
  /** Hauteur géométrique (sans réfraction), degrés. */
  hauteurVraie: number;
  /** Distance Terre-Soleil en unités astronomiques. */
  distanceUA: number;
  /** Déclinaison, degrés. */
  declinaison: number;
  /** Équation du temps, minutes. */
  equationDuTemps: number;
}

/** Correction de réfraction (degrés) à ajouter à la hauteur géométrique. */
export function refraction(hauteurVraie: number): number {
  const h = hauteurVraie;
  if (h > 85) return 0;
  const t = Math.tan(h * RAD);
  let secondes: number;
  if (h > 5) secondes = 58.1 / t - 0.07 / (t * t * t) + 0.000086 / (t * t * t * t * t);
  else if (h > -0.575) secondes = 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)));
  else secondes = -20.774 / t;
  return secondes / 3600;
}

/** Grandeurs qui ne dépendent que de l'instant (pas du lieu). */
function ephemeride(msUTC: number): { decl: number; eot: number; r: number } {
  const jd = msUTC / 86_400_000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const longVraie = L0 + C;
  const anomVraie = M + C;
  const r = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(anomVraie * RAD));
  const omega = 125.04 - 1934.136 * T;
  const lambda = longVraie - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const eot =
    4 *
    DEG *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));
  return { decl, eot, r };
}

/** Position du soleil à un instant UTC (ms depuis 1970) pour un lieu donné. */
export function positionSoleil(msUTC: number, latitude: number, longitude: number): PositionSoleil {
  const { decl, eot, r } = ephemeride(msUTC);
  const minutesUTC = (((msUTC % 86_400_000) + 86_400_000) % 86_400_000) / 60_000;
  const tempsSolaire = (((minutesUTC + eot + 4 * longitude) % 1440) + 1440) % 1440;
  const H = (tempsSolaire / 4 - 180) * RAD; // angle horaire
  const lat = latitude * RAD;
  const sinH = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const hauteurVraie = Math.asin(Math.max(-1, Math.min(1, sinH))) * DEG;
  const az =
    Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) * DEG + 180;
  return {
    azimut: ((az % 360) + 360) % 360,
    hauteur: hauteurVraie + refraction(hauteurVraie),
    hauteurVraie,
    distanceUA: r,
    declinaison: decl * DEG,
    equationDuTemps: eot,
  };
}

/* ------------------------------------------------------------------ */
/* Heure légale française                                              */
/* ------------------------------------------------------------------ */

/** Instant UTC (ms) du dernier dimanche du mois donné à 01:00 UTC. */
function dernierDimanche(annee: number, mois: number): number {
  const fin = new Date(Date.UTC(annee, mois + 1, 0, 1, 0, 0));
  return fin.getTime() - fin.getUTCDay() * 86_400_000;
}

/** Décalage de l'heure légale Europe/Paris par rapport à UTC, en heures (1 ou 2). */
export function decalageParis(msUTC: number): number {
  const annee = new Date(msUTC).getUTCFullYear();
  const debut = dernierDimanche(annee, 2); // dernier dimanche de mars, 01:00 UTC
  const fin = dernierDimanche(annee, 9); // dernier dimanche d'octobre, 01:00 UTC
  return msUTC >= debut && msUTC < fin ? 2 : 1;
}

/** Instant UTC (ms) correspondant à une heure légale de Paris. */
export function utcDepuisHeureLegale(
  annee: number,
  mois: number,
  jour: number,
  heures = 0,
  minutes = 0,
): number {
  const naif = Date.UTC(annee, mois - 1, jour, heures, minutes);
  // Le décalage est évalué à l'instant visé (deux passes suffisent).
  let utc = naif - 3_600_000;
  utc = naif - decalageParis(utc) * 3_600_000;
  return utc;
}

/** Quantième (0-364) → { mois 1-12, jour 1-31 } pour l'année type. */
export function dateDuJour(indexJour: number, annee = ANNEE_TYPE): { mois: number; jour: number } {
  const d = new Date(Date.UTC(annee, 0, 1 + indexJour));
  return { mois: d.getUTCMonth() + 1, jour: d.getUTCDate() };
}

/** { mois, jour } → quantième (0-364). */
export function indexDuJour(mois: number, jour: number, annee = ANNEE_TYPE): number {
  return Math.round((Date.UTC(annee, mois - 1, jour) - Date.UTC(annee, 0, 1)) / 86_400_000);
}

/** Décalage légal (heures) appliqué à un jour entier de l'année type (évalué à midi). */
export function decalageDuJour(indexJour: number, annee = ANNEE_TYPE): number {
  return decalageParis(Date.UTC(annee, 0, 1 + indexJour, 11, 0));
}

/* ------------------------------------------------------------------ */
/* Table annuelle                                                      */
/* ------------------------------------------------------------------ */

export interface TableSolaire {
  latitude: number;
  longitude: number;
  jours: number;
  creneaux: number;
  pasMinutes: number;
  /** Azimut géographique (degrés) au milieu de chaque créneau, [jour × créneau]. */
  azimut: Float32Array;
  /** Hauteur apparente (degrés) au milieu de chaque créneau. */
  hauteur: Float32Array;
  /** Distance Terre-Soleil (UA) pour chaque jour. */
  distanceUA: Float32Array;
  /** Premier et dernier créneau de jour (soleil levé) pour chaque jour. */
  lever: Int16Array;
  coucher: Int16Array;
}

/**
 * Position du soleil pour chaque créneau de l'année type, indexée en heure
 * légale : le créneau c du jour j couvre [c, c+1[ × pas à partir de minuit,
 * heure de Paris. Le changement d'heure a lieu de nuit et n'affecte donc
 * aucun créneau ensoleillé.
 */
export function tableSolaire(
  latitude: number,
  longitude: number,
  annee = ANNEE_TYPE,
  pasMinutes = PAS_MINUTES,
): TableSolaire {
  const creneaux = Math.round(1440 / pasMinutes);
  const n = JOURS * creneaux;
  const azimut = new Float32Array(n);
  const hauteur = new Float32Array(n);
  const distanceUA = new Float32Array(JOURS);
  const lever = new Int16Array(JOURS).fill(-1);
  const coucher = new Int16Array(JOURS).fill(-1);
  const lat = latitude * RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  let declCourant = 0;
  let eotCourant = 0;
  for (let j = 0; j < JOURS; j++) {
    const decalage = decalageDuJour(j, annee);
    const minuitUTC = Date.UTC(annee, 0, 1 + j) - decalage * 3_600_000;
    for (let c = 0; c < creneaux; c++) {
      const ms = minuitUTC + (c + 0.5) * pasMinutes * 60_000;
      // L'éphéméride varie lentement : recalculée toutes les 10 minutes.
      const i = j * creneaux + c;
      if (c % 5 === 0) {
        const e = ephemeride(ms);
        declCourant = e.decl;
        eotCourant = e.eot;
        if (c === 0) distanceUA[j] = e.r;
      }
      const minutesUTC = (((ms % 86_400_000) + 86_400_000) % 86_400_000) / 60_000;
      const ts = (((minutesUTC + eotCourant + 4 * longitude) % 1440) + 1440) % 1440;
      const H = (ts / 4 - 180) * RAD;
      const cosH = Math.cos(H);
      const sinEl = sinLat * Math.sin(declCourant) + cosLat * Math.cos(declCourant) * cosH;
      const hv = Math.asin(Math.max(-1, Math.min(1, sinEl))) * DEG;
      const h = hv + refraction(hv);
      hauteur[i] = h;
      const az = Math.atan2(Math.sin(H), cosH * sinLat - Math.tan(declCourant) * cosLat) * DEG + 180;
      azimut[i] = ((az % 360) + 360) % 360;
      if (h > 0) {
        if (lever[j] < 0) lever[j] = c;
        coucher[j] = c;
      }
    }
  }
  return { latitude, longitude, jours: JOURS, creneaux, pasMinutes, azimut, hauteur, distanceUA, lever, coucher };
}
