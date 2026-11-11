/** Comparateur : jusqu'à quatre logements enregistrés dans le navigateur, côte à côte. */
import { type LogementEnregistre, MAX_LOGEMENTS, ecrireComparateur, lireComparateur } from './etat';
import { annoncer, duree, el, nombre, parId, pourcent } from './outils';
import { themeCourant } from './graphiques/base';

type Critere = { nom: string; valeur: (l: LogementEnregistre) => number; texte: (l: LogementEnregistre) => string; sens: 1 | -1 };

const CRITERES: Critere[] = [
  { nom: 'Soleil par an', valeur: (l) => l.heuresAn, texte: (l) => `${nombre(l.heuresAn)} h`, sens: 1 },
  { nom: 'Hiver, par jour', valeur: (l) => l.moyenneHiver, texte: (l) => duree(l.moyenneHiver), sens: 1 },
  { nom: 'Été, par jour', valeur: (l) => l.moyenneEte, texte: (l) => duree(l.moyenneEte), sens: 1 },
  { nom: 'Jours sans soleil', valeur: (l) => l.joursSansSoleil, texte: (l) => String(l.joursSansSoleil), sens: -1 },
  { nom: 'Part du maximum', valeur: (l) => l.partDuMaximum, texte: (l) => pourcent(l.partDuMaximum), sens: 1 },
  { nom: 'Énergie directe', valeur: (l) => l.energieAn, texte: (l) => `${nombre(l.energieAn)} kWh/m²`, sens: 1 },
  { nom: 'Ciel visible', valeur: (l) => l.cielVisible, texte: (l) => pourcent(l.cielVisible), sens: 1 },
];

function tracerSemaines(canvas: HTMLCanvasElement, semaines: number[], max: number): void {
  const l = canvas.clientWidth || 220;
  const h = 46;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = l * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t = themeCourant();
  ctx.beginPath();
  ctx.moveTo(0, h);
  semaines.forEach((v, i) => ctx.lineTo((i / (semaines.length - 1)) * l, h - 2 - (v / max) * (h - 6)));
  ctx.lineTo(l, h);
  ctx.closePath();
  ctx.fillStyle = t.partiel;
  ctx.fill();
  ctx.beginPath();
  semaines.forEach((v, i) => {
    const x = (i / (semaines.length - 1)) * l;
    const y = h - 2 - (v / max) * (h - 6);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = t.soleil;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export class Comparateur {
  private liste = lireComparateur();
  surOuvrir: (code: string) => void = () => {};

  constructor() {
    document.addEventListener('theme', () => this.afficher());
    this.afficher();
  }

  get nombre(): number {
    return this.liste.length;
  }

  ajouter(l: LogementEnregistre): void {
    const existant = this.liste.findIndex((x) => x.code === l.code);
    if (existant >= 0) this.liste[existant] = l;
    else if (this.liste.length >= MAX_LOGEMENTS) {
      annoncer(`Le comparateur est plein (${MAX_LOGEMENTS} logements). Retirez-en un pour ajouter celui-ci.`);
      this.montrer();
      return;
    } else this.liste.push(l);
    if (!ecrireComparateur(this.liste)) annoncer('Enregistrement impossible : le stockage local du navigateur est désactivé.');
    else annoncer(existant >= 0 ? 'Logement mis à jour dans le comparateur.' : 'Logement ajouté au comparateur.');
    this.afficher();
    this.montrer();
  }

  montrer(): void {
    const bloc = parId('comparateur');
    bloc.hidden = false;
    bloc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  afficher(): void {
    parId('comparateur-nombre').textContent = String(this.liste.length);
    const racine = parId('comparateur-liste');
    if (!this.liste.length) {
      racine.replaceChildren(el('p', { class: 'vide' }, 'Aucun logement enregistré. Étudiez une fenêtre puis touchez « Ajouter au comparateur ».'));
      return;
    }
    const meilleurs = CRITERES.map((c) => (this.liste.length > 1 ? Math.max(...this.liste.map((l) => c.valeur(l) * c.sens)) : NaN));
    const max = Math.max(1, ...this.liste.flatMap((l) => l.semaines));
    const totalMax = Math.max(...this.liste.map((l) => l.heuresAn));
    racine.replaceChildren(
      ...this.liste.map((l) => {
        const canvas = el('canvas', { role: 'img', 'aria-label': 'Heures de soleil par jour au fil de l’année' });
        const dl = el('dl');
        CRITERES.forEach((c, i) => {
          dl.append(el('dt', {}, c.nom), el('dd', { class: c.valeur(l) * c.sens === meilleurs[i] ? 'meilleur' : '' }, c.texte(l)));
        });
        const ouvrir = el('button', { type: 'button', class: 'bouton bouton--petit' }, 'Ouvrir');
        ouvrir.addEventListener('click', () => this.surOuvrir(l.code));
        const retirer = el('button', { type: 'button', class: 'bouton bouton--petit', 'aria-label': `Retirer ${l.titre} du comparateur` }, 'Retirer');
        retirer.addEventListener('click', () => {
          this.liste = this.liste.filter((x) => x.id !== l.id);
          ecrireComparateur(this.liste);
          this.afficher();
        });
        const carte = el(
          'article',
          { class: `logement${this.liste.length > 1 && l.heuresAn === totalMax ? ' logement--meilleur' : ''}` },
          el('div', {}, el('p', { class: 'logement__titre' }, l.titre), el('p', { class: 'logement__sous' }, l.sousTitre + (l.indicatif ? ' · indicatif (sans LiDAR)' : ''))),
          canvas,
          dl,
          el('div', { class: 'logement__actions' }, ouvrir, retirer),
        );
        requestAnimationFrame(() => tracerSemaines(canvas, l.semaines, max));
        return carte;
      }),
    );
  }
}
