import { Graphe, type Survol, type Theme, POLICE } from './base';
import { nombre, orientation } from '../outils';
import { positionSoleil, utcDepuisHeureLegale, ANNEE_TYPE } from '../../coeur/soleil';

export interface DonneesCourse {
  horizon: { k0: number; nk: number; pasAz: number; bati: Float32Array; arbres: Float32Array };
  /** Azimut « grille » de la normale et convergence des méridiens (degrés). */
  azNormale: number;
  convergence: number;
  latitude: number;
  longitude: number;
  arbresComptes: boolean;
}

const MG = 34;
const MD = 8;
const MH = 10;
const MB = 24;
const AZ0 = 30;
const AZ1 = 330;
const EL_MAX = 75;
const CARDINAUX: Array<[number, string]> = [[45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SO'], [270, 'O'], [315, 'NO']];
const COURBES: Array<{ mois: number; jour: number; nom: string }> = [
  { mois: 6, jour: 21, nom: '21 juin' },
  { mois: 3, jour: 20, nom: 'Équinoxes' },
  { mois: 12, jour: 21, nom: '21 déc.' },
];

/** Diagramme solaire : trajectoires du soleil et masque d'horizon vu de la fenêtre. */
export class GrapheCourse extends Graphe<DonneesCourse> {
  protected hauteurPour(l: number): number {
    return Math.max(230, Math.min(340, l * 0.5));
  }

  /** Hauteur de l'horizon (degrés) pour un azimut géographique ; null si derrière la façade. */
  private horizonEn(d: DonneesCourse, azimut: number): { bati: number; arbres: number } | null {
    const h = d.horizon;
    const nAz = Math.round(360 / h.pasAz);
    const k = ((Math.round((azimut - d.convergence) / h.pasAz) % nAz) + nAz) % nAz;
    const j = (k - h.k0 + nAz) % nAz;
    if (j >= h.nk) return null;
    let rel = azimut - d.convergence - d.azNormale;
    rel -= 360 * Math.round(rel / 360);
    if (Math.abs(rel) > 89.5) return null;
    return { bati: Math.max(0, h.bati[j]), arbres: Math.max(0, h.arbres[j]) };
  }

  protected tracer(ctx: CanvasRenderingContext2D, l: number, h: number, t: Theme, d: DonneesCourse): void {
    const x0 = MG;
    const x1 = l - MD;
    const y0 = h - MB;
    const y1 = MH;
    const X = (az: number): number => x0 + ((az - AZ0) / (AZ1 - AZ0)) * (x1 - x0);
    const Y = (el: number): number => y0 - (Math.min(el, EL_MAX) / EL_MAX) * (y0 - y1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y1, x1 - x0, y0 - y1);
    ctx.clip();
    // Zones derrière la façade, masque bâti, masque arboré : colonne par colonne.
    const pasPx = 1;
    for (let x = x0; x < x1; x += pasPx) {
      const az = AZ0 + ((x - x0 + 0.5) / (x1 - x0)) * (AZ1 - AZ0);
      const hz = this.horizonEn(d, az);
      if (!hz) {
        ctx.fillStyle = t.derriere;
        ctx.fillRect(x, y1, pasPx + 0.5, y0 - y1);
        continue;
      }
      if (d.arbresComptes && hz.arbres > hz.bati) {
        ctx.fillStyle = t.arbre;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(x, Y(hz.arbres), pasPx + 0.5, Y(hz.bati) - Y(hz.arbres));
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = t.bati;
      ctx.fillRect(x, Y(hz.bati), pasPx + 0.5, y0 - Y(hz.bati));
    }
    ctx.restore();
    // Grille.
    ctx.font = `11px ${POLICE}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let el = 0; el <= EL_MAX; el += 15) {
      ctx.strokeStyle = t.grille;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(Y(el)) + 0.5);
      ctx.lineTo(x1, Math.round(Y(el)) + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.texteDoux;
      ctx.fillText(`${el}°`, x0 - 6, Y(el));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const [az, nom] of CARDINAUX) {
      ctx.strokeStyle = t.grille;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(Math.round(X(az)) + 0.5, y1);
      ctx.lineTo(Math.round(X(az)) + 0.5, y0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.texteDoux;
      ctx.fillText(nom, X(az), y0 + 5);
    }
    // Trajectoires : en couleur quand le soleil atteint la fenêtre, estompées sinon.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y1, x1 - x0, y0 - y1);
    ctx.clip();
    ctx.lineCap = 'round';
    for (const c of COURBES) {
      const minuit = utcDepuisHeureLegale(ANNEE_TYPE, c.mois, c.jour);
      let precedent: { x: number; y: number; visible: boolean } | null = null;
      let sommet = { x: 0, y: Infinity };
      for (let m = 180; m <= 1380; m += 4) {
        const p = positionSoleil(minuit + m * 60_000, d.latitude, d.longitude);
        if (p.hauteur <= 0) {
          precedent = null;
          continue;
        }
        const hz = this.horizonEn(d, p.azimut);
        const visible = !!hz && p.hauteur > hz.bati && (!d.arbresComptes || p.hauteur > hz.arbres);
        const pt = { x: X(p.azimut), y: Y(p.hauteur), visible };
        if (pt.y < sommet.y) sommet = pt;
        if (precedent) {
          ctx.strokeStyle = visible ? t.soleil : t.texte;
          ctx.lineWidth = visible ? 3 : 1.5;
          ctx.globalAlpha = visible ? 1 : 0.55;
          ctx.setLineDash(visible ? [] : [2, 4]);
          ctx.beginPath();
          ctx.moveTo(precedent.x, precedent.y);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
        }
        // Repères horaires (heure légale).
        if (m % 120 === 0) {
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.fillStyle = t.surface;
          ctx.strokeStyle = visible ? t.soleil : t.axe;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (c.mois !== 3) {
            ctx.font = `10px ${POLICE}`;
            ctx.fillStyle = t.texteDoux;
            ctx.textBaseline = 'bottom';
            ctx.fillText(`${m / 60} h`, pt.x, pt.y - 5);
          }
        }
        precedent = pt;
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = `600 11px ${POLICE}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = t.texte;
      ctx.strokeStyle = t.surface;
      ctx.lineWidth = 3;
      ctx.strokeText(c.nom, sommet.x, sommet.y + 7);
      ctx.fillText(c.nom, sommet.x, sommet.y + 7);
    }
    ctx.restore();
    ctx.strokeStyle = t.axe;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + 0.5);
    ctx.lineTo(x1, y0 + 0.5);
    ctx.stroke();
  }

  protected survol(x: number, y: number, l: number, h: number, d: DonneesCourse): Survol | null {
    if (x < MG || x > l - MD || y < MH || y > h - MB) return null;
    const az = AZ0 + ((x - MG) / (l - MD - MG)) * (AZ1 - AZ0);
    const el = ((h - MB - y) / (h - MB - MH)) * EL_MAX;
    const hz = this.horizonEn(d, az);
    const lignes = hz
      ? `<div class="ligne"><span><i style="background:var(--g-bati)"></i>Bâti, relief</span><span>${nombre(hz.bati)}°</span></div>` +
        (hz.arbres > hz.bati ? `<div class="ligne"><span><i style="background:var(--g-arbre)"></i>Arbres</span><span>${nombre(hz.arbres)}°</span></div>` : '') +
        `<div>${el > Math.max(hz.bati, d.arbresComptes ? hz.arbres : 0) ? 'Ciel dégagé à cette hauteur' : 'Masqué à cette hauteur'}</div>`
      : '<div>Direction située derrière la façade</div>';
    return { x, y, html: `<strong>${orientation(az)} (${nombre(az)}°), ${nombre(el)}° de hauteur</strong>${lignes}` };
  }

  protected htmlLegende(d: DonneesCourse): string {
    return (
      '<span><i style="background:var(--g-soleil)"></i>Soleil visible de la fenêtre</span>' +
      '<span><i style="background:var(--g-bati)"></i>Bâtiments et relief</span>' +
      (d.arbresComptes ? '<span><i style="background:var(--g-arbre)"></i>Arbres</span>' : '') +
      '<span><i style="background:var(--g-derriere)"></i>Derrière la façade</span>'
    );
  }
}
