/**
 * Orchestration du calcul pour une fenêtre : analyse de la façade, masques
 * d'horizon, simulation de chaque étage. Indépendant du navigateur (testable).
 */
import { type Niveau, type Faisceau, calculerFaisceau, horizonPourAltitude } from './horizon';
import { type Relief, type AnalysePoint, analyserPoint, decalageDuMur, azimutDe } from './facades';
import { valeur } from './raster';
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
  /** Hauteur d'étage par défaut (m), utilisée quand le calage est impossible ou désactivé. */
  hauteurEtage: number;
  /** Caler la hauteur d'étage sur le nombre de niveaux connu du bâtiment (BD TOPO) quand il est plausible. */
  hauteurEtageAuto: boolean;
  /** Hauteur de l'appui de fenêtre au-dessus du plancher (m). */
  allege: number;
  arbres: ModeArbres;
  transmissionHiver: number;
  troubleLinke: number;
}

export const REGLAGES_DEFAUT: Reglages = {
  hauteurEtage: 3,
  hauteurEtageAuto: true,
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
  /** Altitude NGF exacte du centre (clic en 3D) ; prioritaire sur tout le reste. */
  altitude?: number | null;
  /** Nombre de niveaux du bâtiment d'après la BD TOPO, rez-de-chaussée compris (renseigné par le moteur). */
  niveauxConnus?: number | null;
  /** Hauteur du bâtiment à la gouttière d'après la BD TOPO (renseignée par le moteur). */
  hauteurConnue?: number | null;
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
  /** Hauteur d'étage retenue (m) et son origine. */
  hauteurEtage: number;
  calage: 'bdtopo' | 'defaut';
  /** Hauteur de bâtiment divisée par le nombre de niveaux, et d'où elle vient (toit LiDAR ou gouttière BD TOPO). */
  hauteurCalage: number;
  baseCalage: 'lidar' | 'gouttiere' | null;
  /** Nombre de niveaux du bâtiment d'après la BD TOPO, s'il est connu (même quand il n'a pas été retenu). */
  niveauxConnus: number | null;
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
/** Écart maximal (m) entre le mur d'un étage et l'origine partagée des rayons. */
const TOLERANCE_ORIGINE = 1;

/** Décalages de référence : un petit nombre d'origines communes à plusieurs étages. */
function decalagesDeReference(decalages: number[]): number[] {
  const tri = [...new Set(decalages)].sort((a, b) => b - a);
  const refs: number[] = [];
  for (const d of tri) if (!refs.length || refs[refs.length - 1] - d > TOLERANCE_ORIGINE) refs.push(d);
  return refs;
}

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

  /**
   * Origine des rayons pour un étage : on réutilise une origine commune un peu
   * plus avancée si elle est bien à l'air libre à cette altitude, sinon le mur
   * propre de l'étage. Les murs réels ne sont pas parfaitement verticaux
   * (corniches, balcons) ; sans ce partage chaque étage relancerait ses rayons.
   */
  private origine(s: SpecFenetre, decalage: number, z: number, refs: number[]): number {
    const dur = this.scene.relief.dur;
    for (let i = refs.length - 1; i >= 0; i--) {
      const ref = refs[i];
      if (ref < decalage || ref - decalage > TOLERANCE_ORIGINE) continue;
      if (ref === decalage) return ref;
      const libre = (d: number) => valeur(dur, s.x + s.nx * d, s.y + s.ny * d, 1e9) <= z - 0.5;
      if (libre(ref + MARGE_AIR) && libre(ref + MARGE_AIR - 0.5) && libre(ref + MARGE_AIR + 0.5)) return ref;
    }
    return decalage;
  }

  analyser(s: SpecFenetre, r: Reglages): AnalysePoint {
    return analyserPoint(this.scene.relief, s.x, s.y, s.nx, s.ny, {
      hauteurEtage: r.hauteurEtage,
      hauteurCentre: r.allege + s.geometrie.hauteur / 2,
      niveauxConnus: r.hauteurEtageAuto ? (s.niveauxConnus ?? null) : null,
      hauteurConnue: s.hauteurConnue ?? null,
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
    const refs = decalagesDeReference(an.etages.filter((e) => e.decalage !== null).map((e) => e.decalage!));
    const etages: ResultatEtage[] = an.etages.map((e) => {
      const hauteur = e.z - an.sol;
      if (e.decalage === null) return { etage: e.etage, hauteur, valide: false, indicateurs: null };
      if (!tousLesEtages) return { etage: e.etage, hauteur, valide: true, indicateurs: null };
      const th = performance.now();
      const ech = this.echantillons(s, this.origine(s, e.decalage, e.z, refs), e.z);
      tHorizon += performance.now() - th;
      return { etage: e.etage, hauteur, valide: true, indicateurs: simuler({ ...commun, echantillons: ech, detail: false }).indicateurs };
    });

    // Étage détaillé.
    let zDetail: number;
    let decalage: number | null;
    if (s.altitude != null || s.hauteurLibre !== null) {
      zDetail = s.altitude != null ? s.altitude : an.sol + s.hauteurLibre!;
      decalage = decalageDuMur(scene.relief, s.x, s.y, s.nx, s.ny, zDetail);
    } else {
      const e = an.etages[s.etage];
      zDetail = an.sol + s.etage * an.hauteurEtage + r.allege + s.geometrie.hauteur / 2;
      decalage = e ? e.decalage : null;
    }
    let detail: ResultatSimulation | null = null;
    let observation: ResultatFenetre['observation'] = null;
    let horizon: ResultatFenetre['horizon'] = null;
    let motif: ResultatFenetre['motif'] = 'ok';
    if (decalage === null) {
      // Au-dessus du dernier niveau détecté (ou trop près du toit), il n'y a pas d'étage : ce n'est pas un mur mitoyen.
      const horsNiveaux = s.hauteurLibre === null && s.altitude == null && s.etage >= an.etages.length;
      motif = an.etages.length === 0 || horsNiveaux || zDetail > an.toit - 0.6 ? 'hors-batiment' : 'mitoyen';
    } else {
      const th = performance.now();
      decalage = this.origine(s, decalage, zDetail, refs);
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
      hauteurEtage: an.hauteurEtage,
      calage: an.cale ? 'bdtopo' : 'defaut',
      hauteurCalage: an.calage.hauteurBatiment,
      baseCalage: an.calage.base,
      niveauxConnus: s.niveauxConnus ?? null,
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
