/**
 * Socle commun des graphiques : canvas net sur écran haute densité, thème,
 * infobulle au survol ou au toucher, légende, tableau de données accessible,
 * et rendu hors écran pour la fiche PDF.
 */
import { el } from '../outils';
import { Etat } from '../../coeur/simulation';

export interface Theme {
  surface: string;
  texte: string;
  texteDoux: string;
  grille: string;
  axe: string;
  soleil: string;
  partiel: string;
  bati: string;
  arbre: string;
  propre: string;
  derriere: string;
  nuit: string;
  reference: string;
  accentFond: string;
}

export const THEME_CLAIR: Theme = {
  surface: '#ffffff',
  texte: '#1f1c16',
  texteDoux: '#5f594c',
  grille: '#e6e0d4',
  axe: '#8a8373',
  soleil: '#e89c00',
  partiel: '#f5cf7a',
  bati: '#4a72c4',
  arbre: '#3f9a5b',
  propre: '#9a5cc0',
  derriere: '#d8d3c8',
  nuit: '#272d45',
  reference: '#1f1c16',
  accentFond: '#fff3d6',
};

export function themeCourant(): Theme {
  const s = getComputedStyle(document.documentElement);
  const v = (nom: string, defaut: string): string => s.getPropertyValue(nom).trim() || defaut;
  return {
    surface: v('--surface', THEME_CLAIR.surface),
    texte: v('--texte', THEME_CLAIR.texte),
    texteDoux: v('--texte-doux', THEME_CLAIR.texteDoux),
    grille: v('--g-grille', THEME_CLAIR.grille),
    axe: v('--g-axe', THEME_CLAIR.axe),
    soleil: v('--g-soleil', THEME_CLAIR.soleil),
    partiel: v('--g-partiel', THEME_CLAIR.partiel),
    bati: v('--g-bati', THEME_CLAIR.bati),
    arbre: v('--g-arbre', THEME_CLAIR.arbre),
    propre: v('--g-propre', THEME_CLAIR.propre),
    derriere: v('--g-derriere', THEME_CLAIR.derriere),
    nuit: v('--g-nuit', THEME_CLAIR.nuit),
    reference: v('--g-reference', THEME_CLAIR.reference),
    accentFond: v('--accent-fond', THEME_CLAIR.accentFond),
  };
}

export const NOM_ETAT: Record<number, string> = {
  [Etat.Nuit]: 'Nuit',
  [Etat.Derriere]: 'Soleil derrière la façade',
  [Etat.OmbreBati]: 'Ombre d’un bâtiment ou du relief',
  [Etat.OmbreArbre]: 'Ombre d’un arbre',
  [Etat.SoleilPartiel]: 'Soleil sur une partie du vitrage',
  [Etat.SoleilPlein]: 'Plein soleil',
  [Etat.OmbrePropre]: 'Masqué par le balcon ou l’embrasure',
};

export function couleurEtat(t: Theme, e: number): string {
  switch (e) {
    case Etat.SoleilPlein:
      return t.soleil;
    case Etat.SoleilPartiel:
      return t.partiel;
    case Etat.OmbreBati:
      return t.bati;
    case Etat.OmbreArbre:
      return t.arbre;
    case Etat.OmbrePropre:
      return t.propre;
    case Etat.Derriere:
      return t.derriere;
    default:
      return t.nuit;
  }
}

/** Légende des états présents dans le calendrier. */
export function legendeEtats(presents: Set<number>): string {
  const ordre = [Etat.SoleilPlein, Etat.SoleilPartiel, Etat.OmbreBati, Etat.OmbreArbre, Etat.OmbrePropre, Etat.Derriere, Etat.Nuit];
  const variable: Record<number, string> = {
    [Etat.SoleilPlein]: '--g-soleil',
    [Etat.SoleilPartiel]: '--g-partiel',
    [Etat.OmbreBati]: '--g-bati',
    [Etat.OmbreArbre]: '--g-arbre',
    [Etat.OmbrePropre]: '--g-propre',
    [Etat.Derriere]: '--g-derriere',
    [Etat.Nuit]: '--g-nuit',
  };
  return ordre
    .filter((e) => presents.has(e))
    .map((e) => `<span><i style="background:var(${variable[e]})"></i>${NOM_ETAT[e]}</span>`)
    .join('');
}

export interface Survol {
  html: string;
  x: number;
  y: number;
}

export interface Tableau {
  legende: string;
  entetes: string[];
  lignes: string[][];
}

export const POLICE = "'Inter Variable', Inter, system-ui, sans-serif";

export abstract class Graphe<D> {
  protected racine: HTMLElement;
  protected canvas: HTMLCanvasElement;
  private bulle: HTMLElement;
  private legende: HTMLElement;
  private details: HTMLDetailsElement;
  protected donnees: D | null = null;
  private largeur = 0;
  private hauteur = 0;

  constructor(conteneur: HTMLElement, description: string, cliquable = false) {
    this.canvas = el('canvas', { role: 'img', 'aria-label': description });
    this.bulle = el('div', { class: 'infobulle', hidden: true });
    this.legende = el('div', { class: 'legende' });
    this.details = el('details', { class: 'donnees' }) as HTMLDetailsElement;
    this.racine = el('div', { class: cliquable ? 'graphe graphe--cliquable' : 'graphe' }, this.canvas, this.bulle);
    conteneur.replaceChildren(this.racine, this.legende, this.details);
    new ResizeObserver(() => this.dessiner()).observe(this.racine);
    document.addEventListener('theme', () => this.dessiner());
    const bouger = (ev: PointerEvent): void => {
      if (!this.donnees) return;
      const r = this.canvas.getBoundingClientRect();
      const s = this.survol(ev.clientX - r.left, ev.clientY - r.top, this.largeur, this.hauteur, this.donnees);
      if (!s) {
        this.bulle.hidden = true;
        return;
      }
      this.bulle.innerHTML = s.html;
      this.bulle.hidden = false;
      const demi = this.bulle.offsetWidth / 2;
      const x = Math.max(demi + 2, Math.min(this.largeur - demi - 2, s.x));
      this.bulle.style.left = `${x}px`;
      this.bulle.style.top = `${Math.max(this.bulle.offsetHeight + 14, s.y)}px`;
    };
    this.canvas.addEventListener('pointermove', bouger);
    this.canvas.addEventListener('pointerdown', bouger);
    this.canvas.addEventListener('pointerleave', () => (this.bulle.hidden = true));
    this.canvas.addEventListener('click', (ev) => {
      if (!this.donnees) return;
      const r = this.canvas.getBoundingClientRect();
      this.clic(ev.clientX - r.left, ev.clientY - r.top, this.largeur, this.hauteur, this.donnees);
    });
    this.details.addEventListener('toggle', () => this.majTableau());
  }

  maj(d: D): void {
    this.donnees = d;
    this.legende.innerHTML = this.htmlLegende(d);
    this.dessiner();
    this.majTableau();
  }

  private majTableau(): void {
    if (!this.donnees) return;
    const t = this.tableau(this.donnees);
    if (!t) {
      this.details.hidden = true;
      return;
    }
    this.details.hidden = false;
    if (!this.details.open) {
      this.details.replaceChildren(el('summary', {}, 'Tableau de données'));
      return;
    }
    const table = el('table', {}, el('caption', { class: 'aide' }, t.legende));
    table.append(el('thead', {}, el('tr', {}, ...t.entetes.map((e) => el('th', { scope: 'col' }, e)))));
    table.append(el('tbody', {}, ...t.lignes.map((l) => el('tr', {}, ...l.map((c, i) => (i === 0 ? el('th', { scope: 'row' }, c) : el('td', {}, c)))))));
    this.details.replaceChildren(el('summary', {}, 'Tableau de données'), el('div', { class: 'tableau-defilant' }, table));
  }

  dessiner(): void {
    if (!this.donnees) return;
    const l = Math.floor(this.racine.clientWidth);
    if (l < 40) return;
    const h = Math.round(this.hauteurPour(l, this.donnees));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.largeur = l;
    this.hauteur = h;
    this.canvas.width = Math.round(l * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.height = `${h}px`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, l, h);
    this.tracer(ctx, l, h, themeCourant(), this.donnees);
  }

  /** Rendu hors écran en thème clair, pour la fiche PDF. */
  image(largeur: number, echelle = 2): HTMLCanvasElement | null {
    if (!this.donnees) return null;
    const h = Math.round(this.hauteurPour(largeur, this.donnees));
    const c = document.createElement('canvas');
    c.width = largeur * echelle;
    c.height = h * echelle;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(echelle, 0, 0, echelle, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largeur, h);
    this.tracer(ctx, largeur, h, THEME_CLAIR, this.donnees);
    return c;
  }

  protected abstract hauteurPour(largeur: number, d: D): number;
  protected abstract tracer(ctx: CanvasRenderingContext2D, l: number, h: number, t: Theme, d: D): void;
  protected survol(_x: number, _y: number, _l: number, _h: number, _d: D): Survol | null {
    return null;
  }
  protected clic(_x: number, _y: number, _l: number, _h: number, _d: D): void {}
  protected htmlLegende(_d: D): string {
    return '';
  }
  protected tableau(_d: D): Tableau | null {
    return null;
  }
}

/** Axe des mois commun aux graphiques annuels. */
export function tracerMois(ctx: CanvasRenderingContext2D, t: Theme, x0: number, x1: number, yBas: number, yHaut: number, noms: string[], debuts: number[]): void {
  ctx.font = `11px ${POLICE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const pas = (x1 - x0) / 365;
  const etroit = x1 - x0 < 420;
  for (let m = 0; m < 12; m++) {
    const x = x0 + debuts[m] * pas;
    ctx.strokeStyle = t.grille;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, yHaut);
    ctx.lineTo(Math.round(x) + 0.5, yBas);
    ctx.stroke();
    ctx.fillStyle = t.texteDoux;
    const nom = etroit ? noms[m][0].toUpperCase() : noms[m];
    ctx.fillText(nom, x + ((debuts[m + 1] - debuts[m]) * pas) / 2, yBas + 5);
  }
}
