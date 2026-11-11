import { Graphe, type Survol, type Tableau, type Theme, POLICE, tracerMois } from './base';
import { DEBUT_MOIS, MOIS, MOIS_COURTS, dateLongue, duree, nombre } from '../outils';

export interface DonneesAnnee {
  heures: Float32Array;
  plein: Float32Array;
  reference: Float32Array;
}

const MG = 34;
const MD = 8;
const MH = 10;
const MB = 24;

/** Heures de soleil par jour sur l'année, avec la référence « façade dégagée ». */
export class GrapheAnnee extends Graphe<DonneesAnnee> {
  surJour: (jour: number) => void = () => {};

  protected hauteurPour(l: number): number {
    return Math.max(200, Math.min(300, l * 0.42));
  }

  private echelle(d: DonneesAnnee): number {
    let m = 0;
    for (const v of d.reference) if (v > m) m = v;
    return Math.max(4, Math.ceil(m / 4) * 4);
  }

  protected tracer(ctx: CanvasRenderingContext2D, l: number, h: number, t: Theme, d: DonneesAnnee): void {
    const x0 = MG;
    const x1 = l - MD;
    const y0 = h - MB;
    const y1 = MH;
    const max = this.echelle(d);
    const X = (j: number): number => x0 + ((j + 0.5) / 365) * (x1 - x0);
    const Y = (v: number): number => y0 - (v / max) * (y0 - y1);
    tracerMois(ctx, t, x0, x1, y0, y1, MOIS_COURTS, DEBUT_MOIS);
    ctx.font = `11px ${POLICE}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= max; v += 4) {
      ctx.strokeStyle = t.grille;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(Y(v)) + 0.5);
      ctx.lineTo(x1, Math.round(Y(v)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = t.texteDoux;
      ctx.fillText(`${v} h`, x0 - 6, Y(v));
    }
    const aire = (serie: Float32Array, couleur: string): void => {
      ctx.beginPath();
      ctx.moveTo(X(0), y0);
      for (let j = 0; j < 365; j++) ctx.lineTo(X(j), Y(serie[j]));
      ctx.lineTo(X(364), y0);
      ctx.closePath();
      ctx.fillStyle = couleur;
      ctx.fill();
    };
    aire(d.heures, t.partiel);
    aire(d.plein, t.soleil);
    // Référence : façade dégagée.
    ctx.beginPath();
    for (let j = 0; j < 365; j++) {
      if (j === 0) ctx.moveTo(X(j), Y(d.reference[j]));
      else ctx.lineTo(X(j), Y(d.reference[j]));
    }
    ctx.strokeStyle = t.reference;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = t.axe;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + 0.5);
    ctx.lineTo(x1, y0 + 0.5);
    ctx.stroke();
  }

  private jourEn(x: number, l: number): number {
    return Math.max(0, Math.min(364, Math.floor(((x - MG) / (l - MD - MG)) * 365)));
  }

  protected survol(x: number, _y: number, l: number, h: number, d: DonneesAnnee): Survol | null {
    if (x < MG - 4 || x > l - MD + 4) return null;
    const j = this.jourEn(x, l);
    const max = this.echelle(d);
    const y = h - MB - (Math.max(d.heures[j], d.reference[j]) / max) * (h - MB - MH);
    return {
      x: MG + ((j + 0.5) / 365) * (l - MD - MG),
      y,
      html:
        `<strong>${dateLongue(j)}</strong>` +
        `<div class="ligne"><span><i style="background:var(--g-partiel)"></i>Soleil</span><span>${duree(d.heures[j])}</span></div>` +
        `<div class="ligne"><span><i style="background:var(--g-soleil)"></i>dont plein vitrage</span><span>${duree(d.plein[j])}</span></div>` +
        `<div class="ligne"><span>Façade dégagée</span><span>${duree(d.reference[j])}</span></div>`,
    };
  }

  protected clic(x: number, _y: number, l: number): void {
    if (x >= MG && x <= l - MD) this.surJour(this.jourEn(x, l));
  }

  protected htmlLegende(): string {
    return (
      '<span><i style="background:var(--g-soleil)"></i>Plein soleil (aucun obstacle)</span>' +
      '<span><i style="background:var(--g-partiel)"></i>Soleil sur une partie du vitrage</span>' +
      '<span><i class="trait"></i>Façade dégagée, même orientation</span>'
    );
  }

  protected tableau(d: DonneesAnnee): Tableau {
    const lignes: string[][] = [];
    for (let m = 0; m < 12; m++) {
      const n = DEBUT_MOIS[m + 1] - DEBUT_MOIS[m];
      let a = 0;
      let b = 0;
      let c = 0;
      for (let j = DEBUT_MOIS[m]; j < DEBUT_MOIS[m + 1]; j++) {
        a += d.heures[j];
        b += d.plein[j];
        c += d.reference[j];
      }
      lignes.push([MOIS[m], duree(a / n), duree(b / n), duree(c / n), nombre(a)]);
    }
    return {
      legende: 'Moyennes mensuelles des heures de soleil direct par jour',
      entetes: ['Mois', 'Soleil par jour', 'dont plein vitrage', 'Façade dégagée', 'Total du mois (h)'],
      lignes,
    };
  }
}
