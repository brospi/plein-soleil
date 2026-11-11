import { Graphe, type Survol, type Tableau, type Theme, NOM_ETAT, POLICE, couleurEtat, legendeEtats, tracerMois } from './base';
import { DEBUT_MOIS, MOIS, MOIS_COURTS, dateLongue, heureDuJour, nombre } from '../outils';
import { Etat } from '../../coeur/simulation';

export interface DonneesCalendrier {
  etats: Uint8Array;
  fractions: Uint8Array;
  creneaux: number;
  /** Jour mis en évidence (détail d'une journée). */
  jour: number;
}

const MG = 34;
const MD = 8;
const MH = 8;
const MB = 24;
const H0 = 4; // de 4 h à 22 h
const H1 = 22;

function rvb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Calendrier solaire : un pixel par jour et par créneau, coloré selon l'état. */
export class GrapheCalendrier extends Graphe<DonneesCalendrier> {
  surJour: (jour: number) => void = () => {};
  private tampon = document.createElement('canvas');

  protected hauteurPour(l: number): number {
    return Math.max(230, Math.min(360, l * 0.5));
  }

  protected tracer(ctx: CanvasRenderingContext2D, l: number, h: number, t: Theme, d: DonneesCalendrier): void {
    const parHeure = d.creneaux / 24;
    const c0 = H0 * parHeure;
    const n = (H1 - H0) * parHeure;
    this.tampon.width = 365;
    this.tampon.height = n;
    const tctx = this.tampon.getContext('2d')!;
    const img = tctx.createImageData(365, n);
    const palette: Array<[number, number, number]> = [];
    for (let e = 0; e <= 6; e++) palette[e] = rvb(couleurEtat(t, e));
    for (let j = 0; j < 365; j++) {
      for (let c = 0; c < n; c++) {
        const p = palette[d.etats[j * d.creneaux + c0 + c]];
        const o = (c * 365 + j) * 4;
        img.data[o] = p[0];
        img.data[o + 1] = p[1];
        img.data[o + 2] = p[2];
        img.data[o + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
    const x0 = MG;
    const x1 = l - MD;
    const y0 = h - MB;
    const y1 = MH;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.tampon, x0, y1, x1 - x0, y0 - y1);
    ctx.imageSmoothingEnabled = true;
    // Heures.
    ctx.font = `11px ${POLICE}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let hh = H0 + 2; hh < H1; hh += 3) {
      const y = y1 + ((hh - H0) / (H1 - H0)) * (y0 - y1);
      ctx.fillStyle = t.texteDoux;
      ctx.fillText(`${hh} h`, x0 - 6, y);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(y) + 0.5);
      ctx.lineTo(x1, Math.round(y) + 0.5);
      ctx.stroke();
    }
    const grilleClaire: Theme = { ...t, grille: 'rgba(255,255,255,0.22)' };
    tracerMois(ctx, grilleClaire, x0, x1, y0, y1, MOIS_COURTS, DEBUT_MOIS);
    // Jour sélectionné.
    const xj = x0 + ((d.jour + 0.5) / 365) * (x1 - x0);
    ctx.strokeStyle = t.texte;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xj, y1 - 4);
    ctx.lineTo(xj, y0 + 3);
    ctx.stroke();
    ctx.fillStyle = t.texte;
    ctx.beginPath();
    ctx.moveTo(xj - 4, y1 - 7);
    ctx.lineTo(xj + 4, y1 - 7);
    ctx.lineTo(xj, y1 - 1);
    ctx.closePath();
    ctx.fill();
  }

  private position(x: number, y: number, l: number, h: number, d: DonneesCalendrier): { jour: number; creneau: number } | null {
    if (x < MG || x > l - MD || y < MH || y > h - MB) return null;
    const jour = Math.min(364, Math.floor(((x - MG) / (l - MD - MG)) * 365));
    const parHeure = d.creneaux / 24;
    const creneau = Math.floor(H0 * parHeure + ((y - MH) / (h - MB - MH)) * (H1 - H0) * parHeure);
    return { jour, creneau };
  }

  protected survol(x: number, y: number, l: number, h: number, d: DonneesCalendrier): Survol | null {
    const p = this.position(x, y, l, h, d);
    if (!p) return null;
    const i = p.jour * d.creneaux + p.creneau;
    const e = d.etats[i];
    const part = e === Etat.SoleilPartiel || e === Etat.SoleilPlein ? `<div>${nombre((d.fractions[i] / 255) * 100)} % du vitrage au soleil</div>` : '';
    return {
      x,
      y,
      html: `<strong>${dateLongue(p.jour)}, ${heureDuJour((p.creneau * 1440) / d.creneaux)}</strong><div>${NOM_ETAT[e]}</div>${part}`,
    };
  }

  protected clic(x: number, y: number, l: number, h: number, d: DonneesCalendrier): void {
    const p = this.position(x, y, l, h, d);
    if (p) this.surJour(p.jour);
  }

  protected htmlLegende(d: DonneesCalendrier): string {
    const presents = new Set<number>();
    for (let i = 0; i < d.etats.length; i += 7) presents.add(d.etats[i]);
    return legendeEtats(presents);
  }

  protected tableau(d: DonneesCalendrier): Tableau {
    const dt = 24 / d.creneaux;
    const lignes: string[][] = [];
    for (let m = 0; m < 12; m++) {
      const compte = new Float64Array(7);
      for (let j = DEBUT_MOIS[m]; j < DEBUT_MOIS[m + 1]; j++) for (let c = 0; c < d.creneaux; c++) compte[d.etats[j * d.creneaux + c]] += dt;
      const n = DEBUT_MOIS[m + 1] - DEBUT_MOIS[m];
      const v = (e: Etat): string => nombre(compte[e] / n, 1);
      lignes.push([MOIS[m], v(Etat.SoleilPlein), v(Etat.SoleilPartiel), v(Etat.OmbreBati), v(Etat.OmbreArbre), v(Etat.OmbrePropre), v(Etat.Derriere)]);
    }
    return {
      legende: 'Répartition moyenne d’une journée, en heures, pour chaque mois',
      entetes: ['Mois', 'Plein soleil', 'Soleil partiel', 'Ombre bâtiment', 'Ombre arbre', 'Balcon, embrasure', 'Derrière la façade'],
      lignes,
    };
  }
}
