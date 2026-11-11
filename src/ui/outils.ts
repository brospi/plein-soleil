/** Petits utilitaires d'interface : DOM, formats français, vocabulaire. */

export function el<K extends keyof HTMLElementTagNameMap>(
  balise: K,
  attributs: Record<string, string | number | boolean | undefined> = {},
  ...enfants: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(balise);
  for (const [k, v] of Object.entries(attributs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'html') e.innerHTML = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of enfants) if (c != null) e.append(c);
  return e;
}

export function parId<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Élément #${id} introuvable`);
  return e as T;
}

export function echapper(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function nombre(v: number, decimales = 0): string {
  return decimales === 0 ? nf0.format(v) : decimales === 1 ? nf1.format(v) : v.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

/** Durée en heures → « 3 h 05 » (ou « 12 min »). */
export function duree(heures: number): string {
  const minutes = Math.round(heures * 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/** Minutes depuis minuit → « 9 h 05 ». */
export function heureDuJour(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function pourcent(v: number): string {
  return `${nf0.format(v * 100)} %`;
}

export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** Quantième (0-364) du premier jour de chaque mois, année non bissextile. */
export const DEBUT_MOIS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

export function dateLongue(indexJour: number): string {
  let m = 0;
  while (m < 11 && indexJour >= DEBUT_MOIS[m + 1]) m++;
  const j = indexJour - DEBUT_MOIS[m] + 1;
  return `${j === 1 ? '1er' : j} ${MOIS[m]}`;
}

export function nomEtage(etage: number): string {
  if (etage === 0) return 'Rez-de-chaussée';
  return etage === 1 ? '1er étage' : `${etage}e étage`;
}
export function nomEtageCourt(etage: number): string {
  return etage === 0 ? 'RDC' : etage === 1 ? '1er' : `${etage}e`;
}

const ROSE = ['nord', 'nord-nord-est', 'nord-est', 'est-nord-est', 'est', 'est-sud-est', 'sud-est', 'sud-sud-est', 'sud', 'sud-sud-ouest', 'sud-ouest', 'ouest-sud-ouest', 'ouest', 'ouest-nord-ouest', 'nord-ouest', 'nord-nord-ouest'];
const ROSE_ABR = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/** Orientation en toutes lettres (« sud-sud-ouest ») d'un azimut géographique. */
export function orientation(azimut: number): string {
  return ROSE[Math.round((((azimut % 360) + 360) % 360) / 22.5) % 16];
}
export function orientationAbregee(azimut: number): string {
  return ROSE_ABR[Math.round((((azimut % 360) + 360) % 360) / 22.5) % 16];
}

let minuterieAnnonce = 0;
/** Message bref en bas d'écran (aussi lu par les lecteurs d'écran). */
export function annoncer(message: string): void {
  const a = parId('annonce');
  a.textContent = message;
  a.classList.add('visible');
  clearTimeout(minuterieAnnonce);
  minuterieAnnonce = window.setTimeout(() => a.classList.remove('visible'), 3200);
}

export function telecharger(nom: string, contenu: Blob): void {
  const url = URL.createObjectURL(contenu);
  const a = el('a', { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function differer<T extends unknown[]>(f: (...a: T) => void, ms: number): (...a: T) => void {
  let t = 0;
  return (...a: T) => {
    clearTimeout(t);
    t = window.setTimeout(() => f(...a), ms);
  };
}
