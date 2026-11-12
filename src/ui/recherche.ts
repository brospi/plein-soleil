/** Champ de recherche d'adresse avec suggestions (clavier, souris, tactile). */
import { type Adresse, chercherAdresses, numeroDemande } from '../donnees/geocodage';
import { el, parId } from './outils';

export function installerRecherche(surChoix: (a: Adresse) => void): { definir(texte: string): void } {
  const champ = parId<HTMLInputElement>('recherche');
  const liste = parId<HTMLUListElement>('suggestions');
  const boite = parId('recherche-boite');
  const etat = parId('recherche-etat');
  let resultats: Adresse[] = [];
  let actif = -1;
  let annulation: AbortController | null = null;
  let minuterie = 0;
  /** Numéro de voie saisi par l'utilisateur pour la dernière recherche aboutie. */
  let numero: string | null = null;
  const numeroManquant = (a: Adresse): boolean => numero !== null && a.precision !== 'numero';

  const fermer = (): void => {
    liste.hidden = true;
    boite.setAttribute('aria-expanded', 'false');
    actif = -1;
  };

  const afficher = (): void => {
    liste.replaceChildren();
    if (!resultats.length) {
      fermer();
      return;
    }
    resultats.forEach((a, i) => {
      const note = numeroManquant(a) ? `Numéro ${numero} introuvable : ${a.precision === 'rue' ? 'rue entière' : 'lieu approché'}` : '';
      const li = el('li', { role: 'option', id: `sug-${i}`, 'aria-selected': i === actif ? 'true' : 'false' }, a.libelle, el('small', {}, [note, a.contexte].filter(Boolean).join(' · ')));
      li.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        choisir(i);
      });
      liste.append(li);
    });
    if (resultats[0].source === 'osm') {
      liste.append(el('li', { class: 'suggestions__source', role: 'presentation' }, 'Service d’adresses de l’IGN indisponible : résultats © OpenStreetMap (Photon).'));
    }
    liste.hidden = false;
    boite.setAttribute('aria-expanded', 'true');
  };

  const choisir = (i: number): void => {
    const a = resultats[i];
    if (!a) return;
    champ.value = a.libelle;
    fermer();
    champ.blur();
    etat.textContent = numeroManquant(a)
      ? `Le numéro ${numero} n’a pas été trouvé : la carte est placée sur ${a.precision === 'rue' ? 'la rue' : 'un lieu proche'}. Déplacez-la jusqu’au bon immeuble, les bâtiments se chargent en chemin.`
      : '';
    surChoix(a);
  };

  const chercher = async (): Promise<void> => {
    const q = champ.value.trim();
    annulation?.abort();
    if (q.length < 3) {
      resultats = [];
      fermer();
      return;
    }
    annulation = new AbortController();
    try {
      resultats = await chercherAdresses(q, annulation.signal);
      numero = numeroDemande(q);
      actif = -1;
      etat.textContent = resultats.length ? '' : 'Aucune adresse trouvée. Précisez la commune ou le code postal.';
      afficher();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      resultats = [];
      fermer();
      etat.textContent = (e as Error).message;
    }
  };

  champ.addEventListener('input', () => {
    clearTimeout(minuterie);
    minuterie = window.setTimeout(chercher, 220);
  });
  champ.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (liste.hidden) return;
      ev.preventDefault();
      actif = (actif + (ev.key === 'ArrowDown' ? 1 : -1) + resultats.length) % resultats.length;
      afficher();
      champ.setAttribute('aria-activedescendant', `sug-${actif}`);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (!liste.hidden && resultats.length) choisir(Math.max(0, actif));
      else void chercher().then(() => resultats.length === 1 && choisir(0));
    } else if (ev.key === 'Escape') fermer();
  });
  champ.addEventListener('blur', () => setTimeout(fermer, 150));
  champ.addEventListener('focus', () => resultats.length && afficher());

  return {
    definir(texte: string) {
      champ.value = texte;
    },
  };
}
