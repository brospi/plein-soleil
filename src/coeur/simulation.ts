/**
 * Simulation annuelle de l'ensoleillement direct d'une fenêtre.
 */
import { type TableSolaire, dateDuJour } from './soleil';
import { type GeometrieFenetre, type RectangleEclaire, rectangleEclaire } from './fenetre';
import { directNormal, TROUBLE_LINKE_DEFAUT } from './cielclair';

const RAD = Math.PI / 180;

/** État d'un créneau de la simulation. */
export enum Etat {
  Nuit = 0,
  Derriere = 1,
  OmbreBati = 2,
  OmbreArbre = 3,
  SoleilPartiel = 4,
  SoleilPlein = 5,
  /** Soleil devant la façade mais vitrage entièrement masqué par l'embrasure ou le balcon. */
  OmbrePropre = 6,
}

/** Prise en compte de la végétation. */
export enum ModeArbres {
  Ignores = 0,
  /** Feuillus : opaques d'avril à octobre, partiellement transparents le reste de l'année. */
  Feuillus = 1,
  /** Persistants : opaques toute l'année. */
  Persistants = 2,
}

/** Horizons (tangentes) vus depuis chaque point d'échantillonnage du vitrage. */
export interface Echantillons {
  nx: number;
  nz: number;
  pasAz: number;
  nAz: number;
  k0: number;
  nk: number;
  /** [ix * nz + iz] → tangentes de l'horizon bâti par azimut. */
  tanDur: Float32Array[];
  tanArb: Float32Array[];
}

export interface ParametresSimulation {
  table: TableSolaire;
  /** Convergence des méridiens (degrés) : azimut grille = azimut géographique − convergence. */
  convergence: number;
  /** Azimut « grille » de la normale extérieure de la façade (degrés). */
  azNormale: number;
  fenetre: GeometrieFenetre;
  echantillons: Echantillons;
  arbres: ModeArbres;
  /** Part de lumière traversant les feuillus hors saison (0 à 1). */
  transmissionHiver: number;
  altitude: number;
  troubleLinke?: number;
  /** Conserver l'état de chaque créneau (calendrier solaire). */
  detail: boolean;
}

export interface Indicateurs {
  /** Heures par an où une partie au moins du vitrage reçoit le soleil. */
  heuresAn: number;
  /** Heures par an où aucun obstacle extérieur ne masque le vitrage. */
  heuresPleinAn: number;
  /** Heures par an pour la même fenêtre sur une façade dégagée. */
  heuresRefAn: number;
  /** Heures-équivalent plein vitrage (heures pondérées par la part éclairée). */
  heuresEquivalentAn: number;
  moyenneJour: number;
  moyenneHiver: number;
  moyenneEte: number;
  joursSansSoleil: number;
  /** heuresAn / heuresRefAn. */
  partDuMaximum: number;
  /** Énergie solaire directe reçue par le vitrage, ciel clair (kWh/m²/an). */
  energieAn: number;
  energieRefAn: number;
  /** Part de ciel visible, relative à une façade verticale dégagée (0 à 1). */
  cielVisible: number;
  /** Hauteur moyenne de l'horizon bâti dans l'axe de la fenêtre (degrés). */
  horizonMoyen: number;
}

export interface ResultatSimulation {
  indicateurs: Indicateurs;
  /** Par jour : heures partiel, plein, référence ; énergie en Wh/m². */
  heuresJour: Float32Array;
  heuresPleinJour: Float32Array;
  heuresRefJour: Float32Array;
  energieJour: Float32Array;
  /** Par créneau (si `detail`) : état et part du vitrage éclairée (0-255). */
  etats: Uint8Array | null;
  fractions: Uint8Array | null;
}

const SEUIL = 0.02;

function estSaisonFeuillue(jour: number): boolean {
  const { mois } = dateDuJour(jour);
  return mois >= 4 && mois <= 10;
}

const FEUILLU = new Uint8Array(365);
for (let j = 0; j < 365; j++) FEUILLU[j] = estSaisonFeuillue(j) ? 1 : 0;

/** Transmission de la végétation pour un jour donné. */
export function transmissionArbres(mode: ModeArbres, jour: number, transmissionHiver: number): number {
  if (mode === ModeArbres.Ignores) return 1;
  if (mode === ModeArbres.Persistants) return 0;
  return FEUILLU[jour] ? 0 : transmissionHiver;
}

export function simuler(p: ParametresSimulation): ResultatSimulation {
  const { table, echantillons: ech, fenetre } = p;
  const { jours, creneaux, pasMinutes } = table;
  const dt = pasMinutes / 60;
  const linke = p.troubleLinke ?? TROUBLE_LINKE_DEFAUT;
  const heuresJour = new Float32Array(jours);
  const heuresPleinJour = new Float32Array(jours);
  const heuresRefJour = new Float32Array(jours);
  const energieJour = new Float32Array(jours);
  const etats = p.detail ? new Uint8Array(jours * creneaux) : null;
  const fractions = p.detail ? new Uint8Array(jours * creneaux) : null;
  const { nx, nz, nk, nAz, k0, pasAz } = ech;
  const poidsX = new Float64Array(nx);
  const poidsZ = new Float64Array(nz);
  const rect: RectangleEclaire = { xa: 0, xb: 1, zb: 1 };
  const rectRef: RectangleEclaire = { xa: 0, xb: 1, zb: 1 };
  let equivalent = 0;
  let energie = 0;
  let energieRef = 0;
  let joursSans = 0;

  for (let j = 0; j < jours; j++) {
    const c0 = table.lever[j];
    const c1 = table.coucher[j];
    if (c0 < 0) {
      joursSans++;
      continue;
    }
    const tau = transmissionArbres(p.arbres, j, p.transmissionHiver);
    const r = table.distanceUA[j];
    let hJ = 0;
    let hP = 0;
    let hR = 0;
    let eJ = 0;
    for (let c = c0; c <= c1; c++) {
      const i = j * creneaux + c;
      const el = table.hauteur[i];
      if (el <= 0) continue;
      const azg = table.azimut[i] - p.convergence;
      let rel = azg - p.azNormale;
      rel -= 360 * Math.round(rel / 360);
      const cosG = Math.cos(rel * RAD);
      if (cosG < 0.0087) {
        if (etats) etats[i] = Etat.Derriere;
        continue;
      }
      const tanEl = Math.tan(el * RAD);
      const tanG = Math.tan(rel * RAD);
      const tanProfil = tanEl / cosG;
      // Référence : même baie, sans balcon ni obstacle lointain.
      const okRef = rectangleEclaire(fenetre, tanG, tanProfil, false, true, rectRef);
      if (!okRef) {
        if (etats) etats[i] = Etat.OmbrePropre;
        continue;
      }
      const fRef = (rectRef.xb - rectRef.xa) * rectRef.zb;
      const dni = directNormal(el, r, p.altitude, linke);
      const cosInc = Math.cos(el * RAD) * cosG;
      hR += dt;
      energieRef += dni * cosInc * fRef * dt;
      if (!rectangleEclaire(fenetre, tanG, tanProfil, true, true, rect)) {
        if (etats) etats[i] = Etat.OmbrePropre;
        continue;
      }
      const k = ((Math.round(azg / pasAz) % nAz) + nAz) % nAz;
      const jk = (k - k0 + nAz) % nAz;
      if (jk >= nk) {
        if (etats) etats[i] = Etat.Derriere;
        continue;
      }
      // Recouvrement de chaque cellule d'échantillonnage avec le rectangle éclairé.
      for (let ix = 0; ix < nx; ix++) {
        const a = Math.max(rect.xa, ix / nx);
        const b = Math.min(rect.xb, (ix + 1) / nx);
        poidsX[ix] = b > a ? b - a : 0;
      }
      for (let iz = 0; iz < nz; iz++) {
        const b = Math.min(rect.zb, (iz + 1) / nz);
        const a = iz / nz;
        poidsZ[iz] = b > a ? b - a : 0;
      }
      let f = 0;
      let fDur = 0;
      for (let ix = 0; ix < nx; ix++) {
        const wx = poidsX[ix];
        if (wx === 0) continue;
        for (let iz = 0; iz < nz; iz++) {
          const w = wx * poidsZ[iz];
          if (w === 0) continue;
          const s = ix * nz + iz;
          if (tanEl > ech.tanDur[s][jk]) {
            fDur += w;
            f += tanEl > ech.tanArb[s][jk] ? w : w * tau;
          }
        }
      }
      if (f > SEUIL) {
        const plein = f >= 0.95 * fRef;
        hJ += dt;
        if (plein) hP += dt;
        equivalent += f * dt;
        const e = dni * cosInc * f * dt;
        eJ += e;
        if (etats) {
          etats[i] = plein ? Etat.SoleilPlein : Etat.SoleilPartiel;
          fractions![i] = Math.min(255, Math.round(f * 255));
        }
      } else if (etats) {
        etats[i] = fDur > SEUIL ? Etat.OmbreArbre : Etat.OmbreBati;
      }
    }
    heuresJour[j] = hJ;
    heuresPleinJour[j] = hP;
    heuresRefJour[j] = hR;
    energieJour[j] = eJ;
    energie += eJ;
    if (hJ === 0) joursSans++;
  }

  const somme = (t: Float32Array, a = 0, b = t.length): number => {
    let s = 0;
    for (let i = a; i < b; i++) s += t[i];
    return s;
  };
  const heuresAn = somme(heuresJour);
  const heuresRefAn = somme(heuresRefJour);
  // Hiver : décembre à février ; été : juin à août (année non bissextile).
  const hiver = (somme(heuresJour, 0, 59) + somme(heuresJour, 334, 365)) / 90;
  const ete = somme(heuresJour, 151, 243) / 92;
  const { cielVisible, horizonMoyen } = cielVisibleEtHorizon(p);
  return {
    indicateurs: {
      heuresAn,
      heuresPleinAn: somme(heuresPleinJour),
      heuresRefAn,
      heuresEquivalentAn: equivalent,
      moyenneJour: heuresAn / jours,
      moyenneHiver: hiver,
      moyenneEte: ete,
      joursSansSoleil: joursSans,
      partDuMaximum: heuresRefAn > 0 ? heuresAn / heuresRefAn : 0,
      energieAn: energie / 1000,
      energieRefAn: energieRef / 1000,
      cielVisible,
      horizonMoyen,
    },
    heuresJour,
    heuresPleinJour,
    heuresRefJour,
    energieJour,
    etats,
    fractions,
  };
}

/**
 * Part de ciel visible depuis le vitrage : facteur de vue du ciel d'un plan
 * vertical, rapporté à celui d'une façade dégagée (0,5). Les obstacles bâtis,
 * le balcon et (sauf mode « ignorés ») les arbres en feuilles sont comptés.
 */
export function cielVisibleEtHorizon(p: Pick<ParametresSimulation, 'echantillons' | 'azNormale' | 'fenetre' | 'arbres'>): {
  cielVisible: number;
  horizonMoyen: number;
} {
  const ech = p.echantillons;
  const { nx, nz, nAz, k0, nk, pasAz } = ech;
  const rect: RectangleEclaire = { xa: 0, xb: 1, zb: 1 };
  const PAS = 2;
  let total = 0;
  let visible = 0;
  let sommeHorizon = 0;
  let nHorizon = 0;
  const centre = Math.floor(nx / 2) * nz + Math.floor(nz / 2);
  for (let g = -89; g <= 89; g += PAS) {
    const azg = p.azNormale + g;
    const k = ((Math.round(azg / pasAz) % nAz) + nAz) % nAz;
    const jk = (k - k0 + nAz) % nAz;
    if (jk >= nk) continue;
    const cosG = Math.cos(g * RAD);
    const tanG = Math.tan(g * RAD);
    if (Math.abs(g) <= 60) {
      sommeHorizon += Math.atan(Math.max(0, ech.tanDur[centre][jk])) / RAD;
      nHorizon++;
    }
    for (let el = 1; el < 90; el += PAS) {
      const cosE = Math.cos(el * RAD);
      const w = cosE * cosE * cosG;
      total += w;
      const tanEl = Math.tan(el * RAD);
      if (!rectangleEclaire(p.fenetre, tanG, tanEl / cosG, true, false, rect)) continue;
      let v = 0;
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          const zHaut = (iz + 0.5) / nz;
          if (zHaut > rect.zb) continue;
          const s = ix * nz + iz;
          if (tanEl > ech.tanDur[s][jk] && (p.arbres === ModeArbres.Ignores || tanEl > ech.tanArb[s][jk])) v++;
        }
      }
      visible += (w * v) / (nx * nz);
    }
  }
  return { cielVisible: total > 0 ? visible / total : 0, horizonMoyen: nHorizon ? sommeHorizon / nHorizon : 0 };
}
