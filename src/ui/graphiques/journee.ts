import { Graphe, type Survol, type Theme, NOM_ETAT, POLICE, couleurEtat, legendeEtats } from './base';
import { duree, heureDuJour, nombre } from '../outils';
import { Etat } from '../../coeur/simulation';

export interface DonneesJournee {
  /** États et parts éclairées des créneaux du jour. */
  etats: Uint8Array;
  fractions: Uint8Array;
}

const MG = 42;
const MD = 8;
const MH = 10;
const MB = 22;
const BANDE = 22;
const H0 = 4;
const H1 = 22;

export interface Creneau {
  debut: number;
  fin: number;
}

/** Plages de soleil d'une journée (minutes depuis minuit), en recollant les interruptions de moins de 6 minutes. */
export function creneauxDeSoleil(etats: Uint8Array): Creneau[] {
  const pas = 1440 / etats.length;
  const plages: Creneau[] = [];
  let debut = -1;
  for (let c = 0; c <= etats.length; c++) {
    const soleil = c < etats.length && (etats[c] === Etat.SoleilPartiel || etats[c] === Etat.SoleilPlein);
    if (soleil && debut < 0) debut = c;
    if (!soleil && debut >= 0) {
      const p = { debut: debut * pas, fin: c * pas };
      const precedent = plages[plages.length - 1];
      if (precedent && p.debut - precedent.fin < 6) precedent.fin = p.fin;
      else plages.push(p);
      debut = -1;
    }
  }
  return plages;
}

export function phraseCreneaux(etats: Uint8Array): string {
  const plages = creneauxDeSoleil(etats);
  if (!plages.length) return 'Aucun soleil direct ce jour-là.';
  const pas = 24 / etats.length;
  let total = 0;
  for (const e of etats) if (e === Etat.SoleilPartiel || e === Etat.SoleilPlein) total += pas;
  const liste = plages.map((p) => `de <strong>${heureDuJour(p.debut)}</strong> à <strong>${heureDuJour(p.fin)}</strong>`);
  const texte = liste.length > 1 ? `${liste.slice(0, -1).join(', ')} et ${liste[liste.length - 1]}` : liste[0];
  return `Soleil ${texte} — <strong>${duree(total)}</strong> au total.`;
}

/** Détail d'une journée : part du vitrage éclairée heure par heure et bandeau des états. */
export class GrapheJournee extends Graphe<DonneesJournee> {
  protected hauteurPour(): number {
    return 190;
  }

  protected tracer(ctx: CanvasRenderingContext2D, l: number, h: number, t: Theme, d: DonneesJournee): void {
    const x0 = MG;
    const x1 = l - MD;
    const yBande = h - MB - BANDE;
    const y0 = yBande - 8;
    const y1 = MH;
    const n = d.etats.length;
    const parHeure = n / 24;
    const X = (c: number): number => x0 + ((c / parHeure - H0) / (H1 - H0)) * (x1 - x0);
    ctx.font = `11px ${POLICE}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const p of [0, 50, 100]) {
      const y = y0 - (p / 100) * (y0 - y1);
      ctx.strokeStyle = t.grille;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(y) + 0.5);
      ctx.lineTo(x1, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = t.texteDoux;
      ctx.fillText(`${p} %`, x0 - 6, y);
    }
    // Part du vitrage au soleil.
    ctx.beginPath();
    ctx.moveTo(X(H0 * parHeure), y0);
    for (let c = H0 * parHeure; c < H1 * parHeure; c++) {
      const f = d.fractions[c] / 255;
      ctx.lineTo(X(c), y0 - f * (y0 - y1));
      ctx.lineTo(X(c + 1), y0 - f * (y0 - y1));
    }
    ctx.lineTo(X(H1 * parHeure), y0);
    ctx.closePath();
    ctx.fillStyle = t.partiel;
    ctx.fill();
    ctx.strokeStyle = t.soleil;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Bandeau des états.
    let debut = H0 * parHeure;
    for (let c = debut + 1; c <= H1 * parHeure; c++) {
      if (c === H1 * parHeure || d.etats[c] !== d.etats[debut]) {
        ctx.fillStyle = couleurEtat(t, d.etats[debut]);
        ctx.fillRect(X(debut), yBande, X(c) - X(debut) + 0.5, BANDE);
        debut = c;
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let hh = 6; hh <= 21; hh += l < 420 ? 3 : 2) {
      const x = X(hh * parHeure);
      ctx.fillStyle = t.texteDoux;
      ctx.fillText(`${hh} h`, x, h - MB + 5);
      ctx.strokeStyle = t.axe;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yBande + BANDE);
      ctx.lineTo(Math.round(x) + 0.5, yBande + BANDE + 3);
      ctx.stroke();
    }
  }

  protected survol(x: number, _y: number, l: number, h: number, d: DonneesJournee): Survol | null {
    if (x < MG || x > l - MD) return null;
    const parHeure = d.etats.length / 24;
    const c = Math.floor((H0 + ((x - MG) / (l - MD - MG)) * (H1 - H0)) * parHeure);
    const e = d.etats[c];
    const f = d.fractions[c] / 255;
    return {
      x,
      y: h - MB - BANDE - 8 - f * (h - MB - BANDE - 8 - MH),
      html: `<strong>${heureDuJour((c * 1440) / d.etats.length)}</strong><div>${NOM_ETAT[e]}</div>${f > 0 ? `<div>${nombre(f * 100)} % du vitrage au soleil</div>` : ''}`,
    };
  }

  protected htmlLegende(d: DonneesJournee): string {
    return legendeEtats(new Set(d.etats));
  }
}
