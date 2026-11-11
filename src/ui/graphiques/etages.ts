import { Graphe, type Survol, type Tableau, type Theme, POLICE } from './base';
import { duree, nombre, nomEtage, nomEtageCourt, pourcent } from '../outils';
import { type ResultatEtage } from '../../coeur/calcul';

export interface DonneesEtages {
  etages: ResultatEtage[];
  actif: number;
  /** Heures par an de la façade dégagée (échelle commune). */
  reference: number;
}

const LIGNE = 30;
const MG = 44;
const MD = 64;
const MH = 4;

/** Barres horizontales par étage, empilées comme une coupe de l'immeuble. */
export class GrapheEtages extends Graphe<DonneesEtages> {
  surEtage: (etage: number) => void = () => {};

  constructor(conteneur: HTMLElement, description: string) {
    super(conteneur, description, true);
  }

  protected hauteurPour(_l: number, d: DonneesEtages): number {
    return MH * 2 + d.etages.length * LIGNE;
  }

  private max(d: DonneesEtages): number {
    return Math.max(d.reference, ...d.etages.map((e) => e.indicateurs?.heuresAn ?? 0), 1);
  }

  protected tracer(ctx: CanvasRenderingContext2D, l: number, _h: number, t: Theme, d: DonneesEtages): void {
    const x0 = MG;
    const x1 = l - MD;
    const max = this.max(d);
    const n = d.etages.length;
    ctx.textBaseline = 'middle';
    d.etages.forEach((e, i) => {
      const y = MH + (n - 1 - i) * LIGNE;
      const actif = e.etage === d.actif;
      if (actif) {
        ctx.fillStyle = t.accentFond;
        ctx.beginPath();
        ctx.roundRect(2, y + 1, l - 4, LIGNE - 2, 7);
        ctx.fill();
      }
      ctx.font = `${actif ? 700 : 500} 12px ${POLICE}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = actif ? t.texte : t.texteDoux;
      ctx.fillText(nomEtageCourt(e.etage), x0 - 8, y + LIGNE / 2);
      ctx.textAlign = 'left';
      if (!e.valide || !e.indicateurs) {
        ctx.font = `italic 12px ${POLICE}`;
        ctx.fillStyle = t.texteDoux;
        ctx.fillText(e.valide ? '…' : 'contre un bâtiment voisin', x0, y + LIGNE / 2);
        return;
      }
      const w = Math.max(2, (e.indicateurs.heuresAn / max) * (x1 - x0));
      ctx.globalAlpha = actif ? 1 : 0.55;
      ctx.fillStyle = t.soleil;
      ctx.beginPath();
      ctx.roundRect(x0, y + 6, w, LIGNE - 12, [0, 4, 4, 0]);
      ctx.fill();
      ctx.globalAlpha = 1;
      // Repère : maximum possible pour l'orientation.
      const xr = x0 + (e.indicateurs.heuresRefAn / max) * (x1 - x0);
      ctx.strokeStyle = t.reference;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xr, y + 4);
      ctx.lineTo(xr, y + LIGNE - 4);
      ctx.stroke();
      ctx.font = `${actif ? 700 : 500} 12px ${POLICE}`;
      ctx.fillStyle = t.texte;
      ctx.fillText(`${nombre(e.indicateurs.heuresAn)} h`, x1 + 8, y + LIGNE / 2);
    });
  }

  private etageEn(y: number, d: DonneesEtages): ResultatEtage | null {
    const i = d.etages.length - 1 - Math.floor((y - MH) / LIGNE);
    return d.etages[i] ?? null;
  }

  protected survol(x: number, y: number, _l: number, _h: number, d: DonneesEtages): Survol | null {
    const e = this.etageEn(y, d);
    if (!e) return null;
    const i = e.indicateurs;
    return {
      x,
      y: MH + (d.etages.length - 1 - d.etages.indexOf(e)) * LIGNE + 4,
      html: i
        ? `<strong>${nomEtage(e.etage)} · ${nombre(e.hauteur, 1)} m</strong>` +
          `<div class="ligne"><span>Soleil par an</span><span>${nombre(i.heuresAn)} h</span></div>` +
          `<div class="ligne"><span>Hiver, par jour</span><span>${duree(i.moyenneHiver)}</span></div>` +
          `<div class="ligne"><span>Été, par jour</span><span>${duree(i.moyenneEte)}</span></div>` +
          `<div class="ligne"><span>Ciel visible</span><span>${pourcent(i.cielVisible)}</span></div>`
        : `<strong>${nomEtage(e.etage)}</strong><div>Le mur donne ici sur un bâtiment voisin.</div>`,
    };
  }

  protected clic(_x: number, y: number, _l: number, _h: number, d: DonneesEtages): void {
    const e = this.etageEn(y, d);
    if (e && e.valide) this.surEtage(e.etage);
  }

  protected htmlLegende(): string {
    return '<span><i style="background:var(--g-soleil)"></i>Heures de soleil par an</span><span><i style="width:2px;background:var(--g-reference)"></i>Maximum possible pour cette orientation</span>';
  }

  protected tableau(d: DonneesEtages): Tableau {
    return {
      legende: 'Indicateurs par étage, même position sur la façade',
      entetes: ['Étage', 'Hauteur', 'Soleil par an', 'Hiver par jour', 'Été par jour', 'Jours sans soleil', 'Ciel visible', 'Énergie directe'],
      lignes: [...d.etages].reverse().map((e) => {
        const i = e.indicateurs;
        return i
          ? [nomEtage(e.etage), `${nombre(e.hauteur, 1)} m`, `${nombre(i.heuresAn)} h`, duree(i.moyenneHiver), duree(i.moyenneEte), String(i.joursSansSoleil), pourcent(i.cielVisible), `${nombre(i.energieAn)} kWh/m²`]
          : [nomEtage(e.etage), `${nombre(e.hauteur, 1)} m`, 'mur mitoyen', '—', '—', '—', '—', '—'];
      }),
    };
  }
}
