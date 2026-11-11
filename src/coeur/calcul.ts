/**
 * Orchestration du calcul pour une fenêtre : analyse de la façade, masques
 * d'horizon, simulation de chaque étage. Indépendant du navigateur (testable).
 */
import { type Niveau, type Faisceau, calculerFaisceau, horizonPourAltitude } from './horizon';
import { type Relief, type AnalysePoint, analyserPoint, decalageDuMur, azimutDe } from './facades';
import { type GeometrieFenetre, grilleEchantillons } from './fenetre';
import { type TableSolaire } from './soleil';
import { type Echantillons, type Indicateurs, type ResultatSimulation, ModeArbres, simuler } from './simulation';

export interface Scene {
  niveaux: Niveau[];
  relief: Relief;
  table: TableSolaire;
  /** Convergence des méridiens au centre de la scène (degrés). */
  convergence: number;
}

export interface Reglages {
  hauteurEtage: number;
  /** Hauteur de l'appui de fenêtre au-dessus du plancher (m). */
  allege: number;
  arbres: ModeArbres;
  transmissionHiver: number;
  troubleLinke: number;
}

export const REGLAGES_DEFAUT: Reglages = {
  hauteurEtage: 3,
  allege: 0.9,
  arbres: ModeArbres.Feuillus,
  transmissionHiver: 0.5,
  troubleLinke: 3,
};

export interface SpecFenetre {
  /** Point de l'arête cadastrale (Lambert 93) et normale extérieure unitaire. */
  x: number;
  y: number;
  nx: number;
  ny: number;
  etage: number;
  /** Hauteur exacte du centre de la fenêtre au-dessus du sol (m) ; prioritaire sur l'étage. */
  hauteurLibre: number | null;
  geometrie: GeometrieFenetre;
}

export interface ResultatEtage {
  etage: number;
  /** Hauteur du centre de la fenêtre au-dessus du sol (m). */
  hauteur: number;
  valide: boolean;
  indicateurs: Indicateurs | null;
}

export interface ResultatFenetre {
  /** Altitude du sol et du toit au droit de la fenêtre (m NGF). */
  sol: number;
  toit: number;
  /** Azimut « grille » de la normale (degrés). */
  azNormale: number;
  etages: ResultatEtage[];
  /** Étage (ou hauteur libre) détaillé. */
  detail: ResultatSimulation | null;
  hauteurDetail: number;
  /** Position réelle du point d'observation central (Lambert 93, m NGF). */
  observation: { x: number; y: number; z: number } | null;
  /** Raison pour laquelle le détail est absent. */
  motif: 'ok' | 'mitoyen' | 'hors-batiment';
  /** Durées de calcul (ms), pour le suivi des performances. */
  chrono: { horizon: number; simulation: number };
  /** Profil d'horizon du point central pour le diagramme solaire (degrés, par azimut calculé). */
  horizon: { k0: number; nk: number; pasAz: number; bati: Float32Array; arbres: Float32Array } | null;
}

const MARGE_AIR = 0.5;

export class Calculateur {
  private cache = new Map<string, Faisceau[]>();

  constructor(public scene: Scene) {}

  private faisceaux(s: SpecFenetre, decalage: number, nx: number): Faisceau[] {
    const cle = [s.x.toFixed(2), s.y.toFixed(2), s.nx.toFixed(4), s.ny.toFixed(4), decalage.toFixed(3), nx, s.geometrie.largeur.toFixed(2)].join('|');
    let f = this.cache.get(cle);
    if (!f) {
      const az = azimutDe(s.nx, s.ny);
      const ux = s.ny;
      const uy = -s.nx;
      f = [];
      for (let ix = 0; ix < nx; ix++) {
        const o = ((ix + 0.5) / nx - 0.5) * s.geometrie.largeur;
        const ox = s.x + ux * o + s.nx * (decalage + MARGE_AIR);
        const oy = s.y + uy * o + s.ny * (decalage + MARGE_AIR);
        f.push(calculerFaisceau(this.scene.niveaux, ox, oy, az));
      }
      if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cle, f);
    }
    return f;
  }

  private echantillons(s: SpecFenetre, decalage: number, zCentre: number): Echantillons {
    const { nx, nz } = grilleEchantillons(s.geometrie);
    const fx = this.faisceaux(s, decalage, nx);
    const tanDur: Float32Array[] = [];
    const tanArb: Float32Array[] = [];
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const z = zCentre + ((iz + 0.5) / nz - 0.5) * s.geometrie.hauteur;
        const d = new Float32Array(fx[ix].nk);
        const a = new Float32Array(fx[ix].nk);
        horizonPourAltitude(fx[ix], z, d, a);
        tanDur.push(d);
        tanArb.push(a);
      }
    }
    const f0 = fx[0];
    return { nx, nz, pasAz: f0.pasAz, nAz: f0.nAz, k0: f0.k0, nk: f0.nk, tanDur, tanArb };
  }

  analyser(s: SpecFenetre, r: Reglages): AnalysePoint {
    return analyserPoint(this.scene.relief, s.x, s.y, s.nx, s.ny, {
      hauteurEtage: r.hauteurEtage,
      hauteurCentre: r.allege + s.geometrie.hauteur / 2,
    });
  }

  /**
   * Calcule tous les étages (indicateurs) et le détail de l'étage demandé.
   * `tousLesEtages = false` ne recalcule que le détail (changement d'étage rapide).
   */
  calculer(s: SpecFenetre, r: Reglages, tousLesEtages = true): ResultatFenetre {
    const t0 = performance.now();
    const { scene } = this;
    const an = this.analyser(s, r);
    const az = azimutDe(s.nx, s.ny);
    const commun = {
      table: scene.table,
      convergence: scene.convergence,
      azNormale: az,
      fenetre: s.geometrie,
      arbres: r.arbres,
      transmissionHiver: r.transmissionHiver,
      altitude: an.sol,
      troubleLinke: r.troubleLinke,
    };
    let tHorizon = 0;
    const etages: ResultatEtage[] = an.etages.map((e) => {
      const hauteur = e.z - an.sol;
      if (e.decalage === null) return { etage: e.etage, hauteur, valide: false, indicateurs: null };
      if (!tousLesEtages) return { etage: e.etage, hauteur, valide: true, indicateurs: null };
      const th = performance.now();
      const ech = this.echantillons(s, e.decalage, e.z);
      tHorizon += performance.now() - th;
      return { etage: e.etage, hauteur, valide: true, indicateurs: simuler({ ...commun, echantillons: ech, detail: false }).indicateurs };
    });

    // Étage détaillé.
    let zDetail: number;
    let decalage: number | null;
    if (s.hauteurLibre !== null) {
      zDetail = an.sol + s.hauteurLibre;
      decalage = decalageDuMur(scene.relief, s.x, s.y, s.nx, s.ny, zDetail);
    } else {
      const e = an.etages[s.etage];
      zDetail = an.sol + s.etage * r.hauteurEtage + r.allege + s.geometrie.hauteur / 2;
      decalage = e ? e.decalage : null;
    }
    let detail: ResultatSimulation | null = null;
    let observation: ResultatFenetre['observation'] = null;
    let horizon: ResultatFenetre['horizon'] = null;
    let motif: ResultatFenetre['motif'] = 'ok';
    if (decalage === null) {
      motif = an.etages.length === 0 || zDetail > an.toit ? 'hors-batiment' : 'mitoyen';
    } else {
      const th = performance.now();
      const ech = this.echantillons(s, decalage, zDetail);
      tHorizon += performance.now() - th;
      detail = simuler({ ...commun, echantillons: ech, detail: true });
      observation = { x: s.x + s.nx * (decalage + MARGE_AIR), y: s.y + s.ny * (decalage + MARGE_AIR), z: zDetail };
      const centre = Math.floor(ech.nx / 2) * ech.nz + Math.floor(ech.nz / 2);
      const bati = new Float32Array(ech.nk);
      const arbres = new Float32Array(ech.nk);
      for (let j = 0; j < ech.nk; j++) {
        bati[j] = (Math.atan(ech.tanDur[centre][j]) * 180) / Math.PI;
        const ta = ech.tanArb[centre][j];
        arbres[j] = ta === -Infinity ? -90 : (Math.atan(ta) * 180) / Math.PI;
      }
      horizon = { k0: ech.k0, nk: ech.nk, pasAz: ech.pasAz, bati, arbres };
    }
    const total = performance.now() - t0;
    return {
      sol: an.sol,
      toit: an.toit,
      azNormale: az,
      etages,
      detail,
      hauteurDetail: zDetail - an.sol,
      observation,
      motif,
      chrono: { horizon: tHorizon, simulation: total - tHorizon },
      horizon,
    };
  }
}
