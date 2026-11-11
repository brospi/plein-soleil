/**
 * Application : relie la recherche, la carte, la vue 3D, le moteur de calcul
 * et l'affichage des résultats.
 */
import { Moteur, ErreurMoteur } from '../moteur/client';
import { type InfoScene, type ResultatCalcul } from '../moteur/protocole';
import { type ResultatEtage, type ResultatFenetre } from '../coeur/calcul';
import { areteLaPlusProche, azimutDe } from '../coeur/facades';
import { ModeArbres } from '../coeur/simulation';
import { CRENEAUX_PAR_JOUR, indexDuJour } from '../coeur/soleil';
import { type Adresse } from '../donnees/geocodage';
import { versLambert93 } from '../coeur/lambert93';
import { Carte, type ChoixMur } from './carte';
import { installerRecherche } from './recherche';
import { Comparateur } from './comparateur';
import { METHODE_HTML } from './methode';
import { exporterCsv, exporterPdf } from './export';
import { type EtatLogement, type FenetreEtat, type LogementEnregistre, decoderEtat, encoderEtat, etatInitial, nouvelleFenetre, versSpec } from './etat';
import { GrapheAnnee } from './graphiques/annee';
import { GrapheCalendrier } from './graphiques/calendrier';
import { GrapheJournee, phraseCreneaux } from './graphiques/journee';
import { GrapheEtages } from './graphiques/etages';
import { GrapheCourse } from './graphiques/course';
import { annoncer, dateLongue, differer, duree, el, nombre, nomEtage, orientation, orientationAbregee, parId, pourcent } from './outils';
import type { Vue3D } from './vue3d';

const EXEMPLES: Array<{ nom: string; libelle: string; lon: number; lat: number }> = [
  { nom: 'Paris 11e', libelle: '45 Rue de la Roquette, 75011 Paris', lon: 2.3737, lat: 48.8548 },
  { nom: 'Montreuil', libelle: '20 Rue du Capitaine Dreyfus, 93100 Montreuil', lon: 2.4407, lat: 48.8585 },
  { nom: 'Lyon 1er', libelle: '8 Rue des Capucins, 69001 Lyon', lon: 4.8336, lat: 45.7689 },
];

export function demarrer(): void {
  const moteur = new Moteur();
  let etat: EtatLogement = etatInitial();
  let scene: InfoScene | null = null;
  let resultat: ResultatCalcul | null = null;
  /** Étages complets de chaque fenêtre, par clé de configuration (hors étage choisi). */
  const etagesConnus = new Map<string, ResultatEtage[]>();
  let jeton = 0;
  let jetonScene = 0;
  let modeAjout = false;
  let altitudeEnAttente: number | null = null;
  let jour = indexDuJour(new Date().getMonth() + 1, Math.min(28, new Date().getDate()));
  let vue3d: Vue3D | null = null;
  let vue3dVisible = false;

  /* ---------- Éléments ---------- */
  const carte = new Carte(parId('carte'));
  const voile = parId('plan-voile');
  const chargement = parId('etat-chargement');
  const blocFenetre = parId('bloc-fenetre');
  const blocResultats = parId('resultats');
  const accueil = parId('accueil');
  const comparateur = new Comparateur();
  parId('methode-contenu').innerHTML = METHODE_HTML;

  const gAnnee = new GrapheAnnee(parId('g-annee'), 'Heures de soleil direct par jour sur l’année');
  const gCalendrier = new GrapheCalendrier(parId('g-calendrier'), 'Calendrier solaire : état de la fenêtre pour chaque jour et chaque heure', true);
  const gJournee = new GrapheJournee(parId('g-journee'), 'Part du vitrage au soleil au fil de la journée');
  const gEtages = new GrapheEtages(parId('g-etages'), 'Heures de soleil par an à chaque étage');
  const gCourse = new GrapheCourse(parId('g-course'), 'Course du soleil et masque d’horizon vus de la fenêtre');

  /* ---------- État et URL ---------- */
  const fenetreActive = (): FenetreEtat | undefined => etat.fenetres[etat.actif];
  const azVrai = (azGrille: number): number => azGrille + (scene?.convergence ?? 0);

  const majURL = (): void => {
    const hash = etat.adresse ? `#l=${encoderEtat(etat)}` : '';
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  };

  const cleEtages = (f: FenetreEtat): string => JSON.stringify([{ ...f, etage: 0, hauteurLibre: null }, etat.reglages, scene?.x, scene?.y]);

  const etatChargement = (message: string | null, erreur = false): void => {
    chargement.hidden = message === null;
    chargement.classList.toggle('erreur', erreur);
    chargement.textContent = message ?? '';
  };
  moteur.surProgression = (m) => etatChargement(m);

  /* ---------- Chargement d'une adresse ---------- */
  async function chargerAdresse(): Promise<void> {
    if (!etat.adresse) return;
    const moi = ++jetonScene;
    scene = null;
    resultat = null;
    etagesConnus.clear();
    carte.afficherScene(null);
    carte.afficherFenetres([], 0);
    carte.centrer(etat.adresse.x, etat.adresse.y);
    voile.hidden = true;
    accueil.hidden = true;
    blocResultats.hidden = true;
    blocFenetre.hidden = true;
    parId('avertissements').replaceChildren();
    etatChargement('Téléchargement du relief LiDAR HD et des bâtiments…');
    majURL();
    try {
      const s = await moteur.charger({ x: etat.adresse.x, y: etat.adresse.y, etages: { hauteurEtage: etat.reglages.hauteurEtage, hauteurCentre: etat.reglages.allege + 0.8 } });
      if (moi !== jetonScene) return;
      scene = s;
      etatChargement(null);
      carte.afficherScene(s);
      afficherAvertissements();
      const radios = document.querySelectorAll<HTMLInputElement>('input[name="arbres"]');
      radios.forEach((r) => (r.disabled = s.mode === 'bdtopo'));
      if (!s.aretes.some((a) => a.statut === 'libre')) {
        etatChargement('Aucun bâtiment n’a été trouvé autour de cette adresse. Vérifiez l’adresse ou déplacez la carte.', true);
      }
      parId('carte-aide').textContent = 'Touchez un mur orange pour y placer la fenêtre. Les murs mitoyens, en pointillés gris, ne sont pas proposés.';
      if (vue3dVisible) void preparer3D(true);
      if (etat.fenetres.length) {
        blocFenetre.hidden = false;
        carte.afficherFenetres(etat.fenetres, etat.actif);
        await lancerCalcul();
      }
    } catch (e) {
      if (moi !== jetonScene) return;
      const err = e as ErreurMoteur;
      etatChargement(err.message, true);
    }
  }

  function afficherAvertissements(): void {
    const racine = parId('avertissements');
    racine.replaceChildren(...(scene?.avertissements ?? []).map((a) => el('p', { class: 'avis' }, a)));
  }

  /* ---------- Calcul ---------- */
  async function lancerCalcul(): Promise<void> {
    if (!scene || !etat.fenetres.length) return;
    const moi = ++jeton;
    const actif = fenetreActive()!;
    const cle = cleEtages(actif);
    const tous = !etagesConnus.has(cle);
    const altitude = altitudeEnAttente;
    altitudeEnAttente = null;
    blocResultats.classList.add('calcul-en-cours');
    majURL();
    majFormulaire();
    carte.afficherFenetres(etat.fenetres, etat.actif);
    try {
      const r = await moteur.calculer({
        fenetres: etat.fenetres.map((f, i) => versSpec(f, i === etat.actif ? altitude : null)),
        actif: etat.actif,
        reglages: etat.reglages,
        tous,
      });
      if (moi !== jeton) return;
      const ra = r.fenetres[etat.actif];
      if (tous) etagesConnus.set(cle, ra.etages);
      else ra.etages = etagesConnus.get(cle)!;
      if (altitude !== null && ra.detail) {
        // Clic en 3D : la hauteur exacte au-dessus du sol devient l'état de référence.
        actif.hauteurLibre = Math.round(ra.hauteurDetail * 100) / 100;
        actif.etage = Math.max(0, Math.min(ra.etages.length - 1, Math.round((ra.hauteurDetail - etat.reglages.allege - actif.hauteur / 2) / etat.reglages.hauteurEtage)));
        majURL();
      }
      resultat = r;
      afficherResultats();
    } catch (e) {
      if (moi !== jeton) return;
      etatChargement((e as Error).message, true);
    } finally {
      if (moi === jeton) blocResultats.classList.remove('calcul-en-cours');
    }
  }
  const calculDiffere = differer(() => void lancerCalcul(), 220);

  /* ---------- Placement de la fenêtre ---------- */
  function placerFenetre(c: ChoixMur, altitude: number | null = null): void {
    if (!scene) return;
    const a = c.arete;
    const ancien = fenetreActive();
    const etageDefaut = Math.max(a.etageMin, Math.min(ancien ? ancien.etage : 2, Math.max(0, a.nbEtages - 1)));
    const f = nouvelleFenetre(c.x, c.y, c.az, etageDefaut, ancien);
    if (modeAjout || !etat.fenetres.length) {
      etat.fenetres.push(f);
      etat.actif = etat.fenetres.length - 1;
    } else {
      etat.fenetres[etat.actif] = f;
    }
    modeAjout = false;
    altitudeEnAttente = altitude;
    blocFenetre.hidden = false;
    void lancerCalcul();
    if (window.matchMedia('(max-width: 1039px)').matches && altitude === null) {
      setTimeout(() => blocFenetre.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    }
  }
  carte.surMur = (c) => placerFenetre(c);
  carte.surMurRefuse = () => annoncer('Ce mur est mitoyen ou accolé à un autre bâtiment : aucune fenêtre possible ici.');

  /* ---------- Formulaire ---------- */
  const champ = (id: string): HTMLInputElement => parId<HTMLInputElement>(id);

  function majFormulaire(): void {
    const f = fenetreActive();
    if (!f) return;
    champ('f-largeur').value = String(f.largeur);
    champ('f-hauteur').value = String(f.hauteur);
    champ('f-embrasure').value = String(f.embrasure);
    champ('f-balcon').checked = f.balcon;
    champ('f-balcon-prof').value = String(f.balconProfondeur);
    champ('f-balcon-deg').value = String(f.balconDegagement);
    parId('balcon-champs').hidden = !f.balcon;
    champ('r-allege').value = String(etat.reglages.allege);
    champ('r-etage-h').value = String(etat.reglages.hauteurEtage);
    champ('r-trans').value = String(Math.round(etat.reglages.transmissionHiver * 100));
    parId('r-trans-texte').textContent = `${Math.round(etat.reglages.transmissionHiver * 100)} %`;
    document.querySelectorAll<HTMLInputElement>('input[name="arbres"]').forEach((r) => (r.checked = Number(r.value) === etat.reglages.arbres));
    parId('trans-ligne').hidden = etat.reglages.arbres !== ModeArbres.Feuillus || scene?.mode === 'bdtopo';
    parId('arbres-aide').textContent =
      scene?.mode === 'bdtopo'
        ? 'Sans LiDAR HD, les arbres ne sont pas connus sur cette zone.'
        : etat.reglages.arbres === ModeArbres.Ignores
          ? 'Les arbres ne font aucune ombre : situation la plus favorable.'
          : etat.reglages.arbres === ModeArbres.Feuillus
            ? 'Les arbres sont opaques d’avril à octobre et laissent passer une partie de la lumière le reste de l’année.'
            : 'Les arbres sont opaques toute l’année : situation la plus défavorable (résineux, feuillage persistant).';
    // Puces des fenêtres.
    const liste = parId('fenetres-liste');
    liste.replaceChildren(
      ...etat.fenetres.map((fe, i) => {
        const puce = el('div', { class: 'puce', role: 'tab', tabindex: '0', 'aria-selected': i === etat.actif ? 'true' : 'false' }, `Fenêtre ${i + 1} · ${orientationAbregee(azVrai(fe.az))}`);
        const choisir = (): void => {
          if (etat.actif === i) return;
          etat.actif = i;
          void lancerCalcul();
        };
        puce.addEventListener('click', choisir);
        puce.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && choisir());
        if (etat.fenetres.length > 1) {
          const fermer = el('button', { type: 'button', class: 'puce__fermer', 'aria-label': `Supprimer la fenêtre ${i + 1}` }, '×');
          fermer.addEventListener('click', (ev) => {
            ev.stopPropagation();
            etat.fenetres.splice(i, 1);
            etat.actif = Math.min(etat.actif, etat.fenetres.length - 1);
            void lancerCalcul();
          });
          puce.append(fermer);
        }
        return puce;
      }),
    );
    if (etat.fenetres.length < 4) {
      const ajout = el('button', { type: 'button', class: 'puce puce--ajout', 'aria-pressed': modeAjout ? 'true' : 'false' }, modeAjout ? 'Touchez un autre mur…' : '+ Ajouter une façade');
      ajout.addEventListener('click', () => {
        modeAjout = !modeAjout;
        majFormulaire();
        if (modeAjout) {
          annoncer('Touchez le mur de la seconde fenêtre sur la carte ou en 3D.');
          parId('carte').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      liste.append(ajout);
    }
  }

  function lierNombre(id: string, appliquer: (v: number) => void): void {
    champ(id).addEventListener('change', () => {
      const e = champ(id);
      const v = Number(e.value.replace(',', '.'));
      if (!Number.isFinite(v)) return;
      const borne = Math.max(Number(e.min), Math.min(Number(e.max), v));
      e.value = String(borne);
      appliquer(borne);
      calculDiffere();
    });
  }
  lierNombre('f-largeur', (v) => (fenetreActive()!.largeur = v));
  lierNombre('f-hauteur', (v) => (fenetreActive()!.hauteur = v));
  lierNombre('f-embrasure', (v) => (fenetreActive()!.embrasure = v));
  lierNombre('f-balcon-prof', (v) => (fenetreActive()!.balconProfondeur = v));
  lierNombre('f-balcon-deg', (v) => (fenetreActive()!.balconDegagement = v));
  lierNombre('r-allege', (v) => (etat.reglages.allege = v));
  lierNombre('r-etage-h', (v) => (etat.reglages.hauteurEtage = v));
  champ('f-balcon').addEventListener('change', () => {
    fenetreActive()!.balcon = champ('f-balcon').checked;
    void lancerCalcul();
  });
  champ('r-trans').addEventListener('input', () => {
    etat.reglages.transmissionHiver = Number(champ('r-trans').value) / 100;
    parId('r-trans-texte').textContent = `${champ('r-trans').value} %`;
    calculDiffere();
  });
  document.querySelectorAll<HTMLInputElement>('input[name="arbres"]').forEach((r) =>
    r.addEventListener('change', () => {
      etat.reglages.arbres = Number(r.value) as ModeArbres;
      void lancerCalcul();
    }),
  );

  function changerEtage(etage: number): void {
    const f = fenetreActive();
    if (!f) return;
    f.etage = etage;
    f.hauteurLibre = null;
    void lancerCalcul();
  }
  function etageVoisin(sens: 1 | -1): number | null {
    const f = fenetreActive();
    const etages = resultat?.fenetres[etat.actif]?.etages;
    if (!f || !etages) return null;
    for (let k = f.etage + sens; k >= 0 && k < etages.length; k += sens) if (etages[k].valide) return k;
    return null;
  }
  parId('etage-moins').addEventListener('click', () => {
    const k = etageVoisin(-1);
    if (k !== null) changerEtage(k);
  });
  parId('etage-plus').addEventListener('click', () => {
    const k = etageVoisin(1);
    if (k !== null) changerEtage(k);
  });
  gEtages.surEtage = changerEtage;

  /* ---------- Affichage des résultats ---------- */
  function descriptionFenetre(f: FenetreEtat, r: ResultatFenetre): string {
    const az = azVrai(f.az);
    const niveau = f.hauteurLibre !== null ? `à ${nombre(r.hauteurDetail, 1)} m du sol (environ ${nomEtage(f.etage).toLowerCase()})` : `${nomEtage(f.etage).toLowerCase()}, centre à ${nombre(r.hauteurDetail, 1)} m du sol`;
    return `Fenêtre orientée ${orientation(az)} (${nombre(((az % 360) + 360) % 360)}°), ${niveau} · vitrage ${nombre(f.largeur, 1)} × ${nombre(f.hauteur, 1)} m${f.balcon ? ', balcon au-dessus' : ''}`;
  }

  function carteIndicateur(nom: string, valeur: string, unite: string, note = '', phare = false): HTMLElement {
    return el(
      'div',
      { class: `indicateur${phare ? ' indicateur--phare' : ''}` },
      el('p', { class: 'indicateur__nom' }, nom),
      el('p', { class: 'indicateur__valeur' }, valeur, unite ? el('span', { class: 'indicateur__unite' }, unite) : null),
      note ? el('p', { class: 'indicateur__note' }, note) : null,
    );
  }

  /** Moyenne quotidienne de mars à mai et de septembre à novembre. */
  function miSaison(h: Float32Array): number {
    let s = 0;
    for (let j = 59; j < 151; j++) s += h[j];
    for (let j = 243; j < 334; j++) s += h[j];
    return s / 183;
  }

  function afficherJournee(): void {
    const d = resultat?.fenetres[etat.actif]?.detail;
    if (!d?.etats) return;
    const debut = jour * CRENEAUX_PAR_JOUR;
    const etats = d.etats.subarray(debut, debut + CRENEAUX_PAR_JOUR);
    gJournee.maj({ etats, fractions: d.fractions!.subarray(debut, debut + CRENEAUX_PAR_JOUR) });
    parId('jour-texte').textContent = dateLongue(jour);
    champ('jour-curseur').value = String(jour);
    parId('jour-creneaux').innerHTML = phraseCreneaux(etats);
    gCalendrier.maj({ etats: d.etats, fractions: d.fractions!, creneaux: CRENEAUX_PAR_JOUR, jour });
  }
  const choisirJour = (j: number): void => {
    jour = j;
    afficherJournee();
    vue3d?.definirJour(jour);
  };
  gCalendrier.surJour = choisirJour;
  gAnnee.surJour = choisirJour;
  champ('jour-curseur').addEventListener('input', () => choisirJour(Number(champ('jour-curseur').value)));
  for (const [nom, mois, j] of [['21 déc.', 12, 21], ['20 mars', 3, 20], ['21 juin', 6, 21], ['23 sept.', 9, 23]] as Array<[string, number, number]>) {
    const b = el('button', { type: 'button', class: 'bouton bouton--petit' }, nom);
    b.addEventListener('click', () => choisirJour(indexDuJour(mois, j)));
    parId('jour-raccourcis').append(b);
  }

  function majEtage(f: FenetreEtat, r: ResultatFenetre): void {
    parId('etage-libelle').textContent = f.hauteurLibre !== null ? `${nombre(r.hauteurDetail, 1)} m du sol` : nomEtage(f.etage);
    const dernier = r.etages.length - 1;
    parId('etage-detail').textContent =
      r.etages.length === 0
        ? 'Aucun étage détecté ici'
        : `${f.hauteurLibre !== null ? `Hauteur choisie en 3D, proche du ${nomEtage(f.etage).toLowerCase()}` : `Centre de la fenêtre à ${nombre(r.hauteurDetail, 1)} m du sol`} · immeuble estimé à R+${dernier} (${nombre(r.toit - r.sol, 1)} m)`;
    parId<HTMLButtonElement>('etage-moins').disabled = etageVoisin(-1) === null;
    parId<HTMLButtonElement>('etage-plus').disabled = etageVoisin(1) === null;
  }

  function afficherResultats(): void {
    if (!resultat || !scene) return;
    const f = fenetreActive()!;
    const r = resultat.fenetres[etat.actif];
    etatChargement(null);
    blocResultats.hidden = false;
    accueil.hidden = true;
    majFormulaire();
    majEtage(f, r);
    parId('t-resume').textContent = etat.adresse?.libelle ?? 'Logement';
    parId('resume-sous-titre').textContent = descriptionFenetre(f, r);
    const zoneIndicateurs = parId('indicateurs');
    const explication = parId('explication');
    const graphiques = blocResultats.querySelectorAll<HTMLElement>('section:not(.resume)');
    const actions = blocResultats.querySelectorAll<HTMLButtonElement>('.resume__actions button');
    vue3d?.definirFenetres(observations());

    if (!r.detail) {
      zoneIndicateurs.replaceChildren();
      explication.hidden = false;
      explication.innerHTML =
        r.motif === 'mitoyen'
          ? `<p><strong>À cette hauteur, le mur ne donne pas sur l’extérieur.</strong></p><p>D’après le LiDAR, un bâtiment voisin ou un volume couvert s’appuie contre la façade au niveau choisi. ${r.etages.some((e) => e.valide) ? 'Choisissez un étage plus élevé avec le bouton +.' : 'Aucun étage de ce mur n’est dégagé : choisissez une autre façade.'}</p>`
          : '<p><strong>La hauteur choisie dépasse le toit relevé par le LiDAR.</strong></p><p>Choisissez un étage plus bas, ou vérifiez la hauteur d’étage dans les réglages.</p>';
      graphiques.forEach((s) => (s.hidden = true));
      actions.forEach((b) => (b.disabled = true));
      return;
    }
    graphiques.forEach((s) => (s.hidden = s.id === 'bloc-facades' ? etat.fenetres.length < 2 : false));
    actions.forEach((b) => (b.disabled = false));
    const i = r.detail.indicateurs;
    const cumul = resultat.cumul;
    zoneIndicateurs.replaceChildren(
      carteIndicateur('Soleil direct par an, ciel clair', nombre(i.heuresAn), 'h', `${pourcent(i.partDuMaximum)} du maximum pour une façade ${orientation(azVrai(f.az))} dégagée (${nombre(i.heuresRefAn)} h)`, true),
      carteIndicateur('Moyenne par jour', duree(i.moyenneJour), '', 'sur l’année'),
      carteIndicateur('En hiver', duree(i.moyenneHiver), '', 'par jour, déc. à févr.'),
      carteIndicateur('En été', duree(i.moyenneEte), '', 'par jour, juin à août'),
      carteIndicateur('À la mi-saison', duree(miSaison(r.detail.heuresJour)), '', 'par jour, mars à mai et sept. à nov.'),
      carteIndicateur('Jours sans soleil', String(i.joursSansSoleil), i.joursSansSoleil > 1 ? 'jours' : 'jour', 'sur 365'),
      carteIndicateur('Plein soleil', nombre(i.heuresPleinAn), 'h', 'par an, vitrage entièrement dégagé'),
      carteIndicateur('Énergie solaire directe', nombre(i.energieAn), 'kWh/m²', 'par an sur le vitrage, ciel clair'),
      carteIndicateur('Ciel visible', pourcent(i.cielVisible), '', 'lumière diffuse, 100 % = façade dégagée'),
      ...(cumul ? [carteIndicateur('Logement entier', nombre(cumul.heuresAn), 'h', `par an avec au moins une des ${etat.fenetres.length} fenêtres au soleil`)] : []),
    );

    // Explications contextuelles (courette, façade nord, repli sans LiDAR).
    const messages: string[] = [];
    if (i.heuresAn < 1) {
      messages.push(
        i.cielVisible < 0.3
          ? `<p><strong>Aucun soleil direct de l’année : ce résultat est cohérent.</strong></p><p>La fenêtre ne voit que ${pourcent(i.cielVisible)} du ciel : elle donne sur une cour étroite, un puits de lumière ou un vis-à-vis très proche, dont les murs montent en moyenne à ${nombre(i.horizonMoyen)}° au-dessus de l’horizon. Le soleil ne descend jamais dans cet espace à cette hauteur. Essayez un étage plus élevé.</p>`
          : '<p><strong>Aucun soleil direct de l’année.</strong></p><p>Les obstacles en face masquent toute la course du soleil devant cette façade. Le diagramme de course du soleil, plus bas, montre où.</p>',
      );
    } else if (i.cielVisible < 0.3) {
      messages.push(`<p><strong>Fenêtre sur cour étroite.</strong> Elle ne voit que ${pourcent(i.cielVisible)} du ciel : le soleil n’y entre que lorsqu’il est haut, donc surtout en été.</p>`);
    }
    if (i.moyenneHiver === 0 && i.heuresRefAn > 0 && i.heuresAn >= 1) {
      const nord = Math.abs((((azVrai(f.az) + 180) % 360) + 360) % 360 - 180) < 60;
      messages.push(
        nord
          ? '<p><strong>Pas de soleil direct en hiver</strong> : c’est normal pour une façade tournée vers le nord, où le soleil ne passe que tôt le matin et tard le soir à la belle saison.</p>'
          : '<p><strong>Pas de soleil direct de décembre à février</strong> : le soleil d’hiver, bas sur l’horizon, reste derrière les obstacles en face.</p>',
      );
    }
    if (scene.mode === 'bdtopo') messages.push('<p><strong>Résultat indicatif.</strong> Le LiDAR HD n’est pas publié ici : le calcul utilise des bâtiments simplifiés et ignore les arbres.</p>');
    explication.hidden = messages.length === 0;
    explication.innerHTML = messages.join('');

    gAnnee.maj({ heures: r.detail.heuresJour, plein: r.detail.heuresPleinJour, reference: r.detail.heuresRefJour });
    afficherJournee();
    gEtages.maj({ etages: r.etages, actif: f.hauteurLibre === null ? f.etage : -1, reference: i.heuresRefAn });
    if (r.horizon) {
      gCourse.maj({
        horizon: r.horizon,
        azNormale: r.azNormale,
        convergence: scene.convergence,
        latitude: scene.lat,
        longitude: scene.lon,
        arbresComptes: etat.reglages.arbres !== ModeArbres.Ignores && scene.mode === 'lidar',
      });
    }
    afficherFacades();
  }

  function tableauFacades(): { entetes: string[]; lignes: string[][]; actif: number } | null {
    if (!resultat || etat.fenetres.length < 2) return null;
    const lignes = resultat.fenetres.map((r, k) => {
      const f = etat.fenetres[k];
      const nom = `Fenêtre ${k + 1} · ${orientation(azVrai(f.az))}, ${f.hauteurLibre !== null ? `${nombre(r.hauteurDetail, 1)} m` : nomEtage(f.etage).toLowerCase()}`;
      const i = r.detail?.indicateurs;
      return i ? [nom, `${nombre(i.heuresAn)} h`, duree(i.moyenneHiver), duree(i.moyenneEte), String(i.joursSansSoleil), pourcent(i.cielVisible), `${nombre(i.energieAn)} kWh/m²`] : [nom, 'mur mitoyen', '—', '—', '—', '—', '—'];
    });
    const c = resultat.cumul;
    if (c) lignes.push(['Logement (au moins une fenêtre)', `${nombre(c.heuresAn)} h`, duree(c.moyenneHiver), duree(c.moyenneEte), String(c.joursSansSoleil), '', '']);
    return { entetes: ['Fenêtre', 'Soleil par an', 'Hiver par jour', 'Été par jour', 'Jours sans soleil', 'Ciel visible', 'Énergie directe'], lignes, actif: etat.actif };
  }

  function afficherFacades(): void {
    const t = tableauFacades();
    parId('bloc-facades').hidden = !t;
    if (!t) return;
    const table = el('table', {}, el('thead', {}, el('tr', {}, ...t.entetes.map((e) => el('th', { scope: 'col' }, e)))));
    table.append(
      el(
        'tbody',
        {},
        ...t.lignes.map((l, k) => el('tr', { class: k === t.actif ? 'actif' : k === etat.fenetres.length ? 'total' : '' }, ...l.map((c, n) => (n === 0 ? el('th', { scope: 'row' }, c) : el('td', {}, c))))),
      ),
    );
    parId('facades-tableau').replaceChildren(table);
  }

  /* ---------- Actions : comparateur, partage, exports ---------- */
  function instantane(): LogementEnregistre | null {
    if (!resultat || !etat.adresse || !scene) return null;
    const r = resultat.fenetres[etat.actif];
    if (!r.detail) return null;
    const f = fenetreActive()!;
    const i = r.detail.indicateurs;
    const c = resultat.cumul;
    const heuresJour = c ? c.heuresJour : r.detail.heuresJour;
    const semaines: number[] = [];
    for (let s = 0; s < 52; s++) {
      let somme = 0;
      for (let j = s * 7; j < s * 7 + 7; j++) somme += heuresJour[j];
      semaines.push(Math.round((somme / 7) * 10) / 10);
    }
    const orientations = etat.fenetres.map((x) => orientationAbregee(azVrai(x.az))).join(' + ');
    return {
      id: `${Date.now()}`,
      titre: etat.adresse.libelle,
      sousTitre: `${f.hauteurLibre !== null ? `${nombre(r.hauteurDetail, 1)} m` : nomEtage(f.etage)} · ${orientations}${etat.fenetres.length > 1 ? ` (${etat.fenetres.length} fenêtres)` : ''}`,
      code: encoderEtat(etat),
      heuresAn: c ? c.heuresAn : i.heuresAn,
      moyenneHiver: c ? c.moyenneHiver : i.moyenneHiver,
      moyenneEte: c ? c.moyenneEte : i.moyenneEte,
      joursSansSoleil: c ? c.joursSansSoleil : i.joursSansSoleil,
      partDuMaximum: i.partDuMaximum,
      energieAn: i.energieAn,
      cielVisible: i.cielVisible,
      semaines,
      indicatif: scene.mode === 'bdtopo',
    };
  }

  parId('b-enregistrer').addEventListener('click', () => {
    const l = instantane();
    if (l) comparateur.ajouter(l);
  });
  parId('comparateur-bouton').addEventListener('click', () => comparateur.montrer());
  comparateur.surOuvrir = (code) => {
    const e = decoderEtat(code);
    if (!e) return;
    etat = e;
    recherche.definir(e.adresse?.libelle ?? '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void chargerAdresse();
  };

  parId('b-partager').addEventListener('click', async () => {
    majURL();
    try {
      await navigator.clipboard.writeText(location.href);
      annoncer('Lien copié : il rouvre exactement ce calcul.');
    } catch {
      prompt('Copiez ce lien :', location.href);
    }
  });

  parId('b-csv').addEventListener('click', () => {
    const r = resultat?.fenetres[etat.actif];
    if (!r?.detail || !etat.adresse) return;
    exporterCsv({
      adresse: etat.adresse.libelle,
      description: descriptionFenetre(fenetreActive()!, r),
      heures: r.detail.heuresJour,
      plein: r.detail.heuresPleinJour,
      reference: r.detail.heuresRefJour,
      energie: r.detail.energieJour,
    });
  });

  parId('b-pdf').addEventListener('click', async () => {
    const r = resultat?.fenetres[etat.actif];
    if (!r?.detail || !etat.adresse || !scene) return;
    const bouton = parId<HTMLButtonElement>('b-pdf');
    bouton.disabled = true;
    bouton.textContent = 'Préparation…';
    try {
      majURL();
      const images: Array<{ titre: string; legende: string; image: HTMLCanvasElement }> = [];
      const ajouter = (titre: string, legende: string, image: HTMLCanvasElement | null): void => {
        if (image) images.push({ titre, legende, image });
      };
      ajouter('Heures de soleil, jour par jour', 'Orange : plein soleil. Jaune pâle : soleil sur une partie du vitrage. Pointillés : même fenêtre sur une façade dégagée.', gAnnee.image(760));
      ajouter(
        'Calendrier solaire',
        'Une colonne par jour, une ligne par heure légale. Orange : soleil. Bleu : ombre d’un bâtiment ou du relief. Vert : ombre d’un arbre. Violet : balcon ou embrasure. Gris clair : soleil derrière la façade. Bleu nuit : nuit.',
        gCalendrier.image(760),
      );
      ajouter('Course du soleil et masque d’horizon vus de la fenêtre', 'Trait orange : soleil visible de la fenêtre. Bleu : bâtiments et relief. Vert : arbres. Gris clair : directions situées derrière la façade.', gCourse.image(760));
      const t = tableauFacades();
      await exporterPdf({
        adresse: etat.adresse.libelle,
        description: descriptionFenetre(fenetreActive()!, r),
        indicateurs: r.detail.indicateurs,
        avertissements: scene.avertissements,
        graphiques: images,
        facades: t ? { entetes: t.entetes, lignes: t.lignes } : null,
        etages: {
          entetes: ['Étage', 'Hauteur', 'Soleil par an', 'Hiver par jour', 'Été par jour', 'Jours sans soleil', 'Ciel visible'],
          lignes: [...r.etages].reverse().map((e) => {
            const x = e.indicateurs;
            return x
              ? [nomEtage(e.etage), `${nombre(e.hauteur, 1)} m`, `${nombre(x.heuresAn)} h`, duree(x.moyenneHiver), duree(x.moyenneEte), String(x.joursSansSoleil), pourcent(x.cielVisible)]
              : [nomEtage(e.etage), `${nombre(e.hauteur, 1)} m`, 'mur mitoyen', '—', '—', '—', '—'];
          }),
        },
        lien: location.href,
      });
    } catch (e) {
      annoncer(`La fiche PDF n’a pas pu être créée : ${(e as Error).message}`);
    } finally {
      bouton.disabled = false;
      bouton.textContent = 'Fiche PDF';
    }
  });

  /* ---------- Carte / 3D ---------- */
  function observations(): Array<{ x: number; y: number; z: number; az: number; largeur: number; hauteur: number; actif: boolean }> {
    if (!resultat) return [];
    return resultat.fenetres.flatMap((r, k) => {
      const f = etat.fenetres[k];
      return r.observation && f ? [{ ...r.observation, az: f.az, largeur: f.largeur, hauteur: f.hauteur, actif: k === etat.actif }] : [];
    });
  }

  async function preparer3D(nouvelleScene = false): Promise<void> {
    if (!scene) return;
    const message = parId('vue3d-message');
    try {
      if (!vue3d) {
        message.hidden = false;
        message.textContent = 'Chargement de la vue 3D…';
        const module = await import('./vue3d');
        vue3d = new module.Vue3D(parId<HTMLCanvasElement>('vue3d-canvas'), moteur);
        vue3d.surMur = (p) => {
          if (!scene) return;
          const proche = areteLaPlusProche(scene.aretes, p.x, p.y, 4, (a) => a.statut === 'libre' && a.nx * p.nx + a.ny * p.ny > 0.5);
          if (!proche) {
            annoncer('Cliquez sur une façade donnant sur l’extérieur (mur orange sur la carte).');
            return;
          }
          placerFenetre({ x: proche.x, y: proche.y, az: azimutDe(proche.arete.nx, proche.arete.ny), arete: proche.arete }, p.altitude);
        };
        vue3d.definirJour(jour);
        nouvelleScene = true;
      }
      if (nouvelleScene) {
        message.hidden = false;
        message.textContent = 'Construction du maillage 3D…';
        const f = fenetreActive();
        await vue3d.chargerScene(scene, f ? { x: f.x, y: f.y, az: f.az } : { x: scene.x, y: scene.y, az: null });
        vue3d.definirFenetres(observations());
      }
      message.hidden = true;
    } catch (e) {
      message.hidden = false;
      message.textContent = `La vue 3D n’a pas pu s’afficher : ${(e as Error).message}`;
    }
  }

  const ongletCarte = parId('onglet-carte');
  const onglet3d = parId('onglet-3d');
  function basculerVue(troisD: boolean): void {
    vue3dVisible = troisD;
    ongletCarte.setAttribute('aria-selected', String(!troisD));
    onglet3d.setAttribute('aria-selected', String(troisD));
    parId('carte').hidden = troisD;
    parId('vue3d').hidden = !troisD;
    parId('fond-bouton').hidden = troisD;
    plan.classList.toggle('plan--3d', troisD);
    parId('carte-aide').textContent = troisD
      ? 'Faites glisser pour tourner, pincez ou utilisez la molette pour zoomer. Touchez une façade pour y placer la fenêtre à la hauteur exacte.'
      : 'Touchez un mur orange pour y placer la fenêtre. Les murs mitoyens, en pointillés gris, ne sont pas proposés.';
    if (troisD) void preparer3D(vue3d !== null && vue3d.sceneCourante !== scene).then(() => vue3d?.redimensionner());
    else carte.redimensionner();
  }
  ongletCarte.addEventListener('click', () => basculerVue(false));
  onglet3d.addEventListener('click', () => {
    if (!scene) {
      annoncer('Saisissez d’abord une adresse.');
      return;
    }
    basculerVue(true);
  });
  const fond = parId('fond-bouton');
  fond.addEventListener('click', () => {
    const photo = fond.getAttribute('aria-pressed') !== 'true';
    fond.setAttribute('aria-pressed', String(photo));
    fond.textContent = photo ? 'Plan' : 'Photo aérienne';
    carte.basculerFond(photo);
  });

  const plan = document.querySelector<HTMLElement>('.plan')!;
  const agrandir = parId('plan-agrandir');
  const basculerPleinEcran = (actif: boolean): void => {
    plan.classList.toggle('plan--plein', actif);
    document.body.classList.toggle('sans-defilement', actif);
    agrandir.setAttribute('aria-pressed', String(actif));
    agrandir.textContent = actif ? 'Réduire' : 'Agrandir';
    carte.redimensionner();
    vue3d?.redimensionner();
  };
  agrandir.addEventListener('click', () => basculerPleinEcran(!plan.classList.contains('plan--plein')));
  document.addEventListener('keydown', (ev) => ev.key === 'Escape' && plan.classList.contains('plan--plein') && basculerPleinEcran(false));

  /* ---------- Thème ---------- */
  parId('theme-bouton').addEventListener('click', () => {
    const racine = document.documentElement;
    const sombre = racine.dataset.theme ? racine.dataset.theme === 'sombre' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    racine.dataset.theme = sombre ? 'clair' : 'sombre';
    try {
      localStorage.setItem('plein-soleil:theme', racine.dataset.theme);
    } catch {
      /* stockage indisponible */
    }
    document.dispatchEvent(new Event('theme'));
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => document.dispatchEvent(new Event('theme')));

  /* ---------- Recherche, exemples, démarrage ---------- */
  const choisirAdresse = (a: Pick<Adresse, 'libelle' | 'x' | 'y'>): void => {
    etat = { ...etatInitial(), reglages: etat.reglages, adresse: { libelle: a.libelle, x: a.x, y: a.y } };
    modeAjout = false;
    void chargerAdresse();
  };
  const recherche = installerRecherche(choisirAdresse);
  const exemples = parId('exemples');
  EXEMPLES.forEach((ex, k) => {
    const b = el('button', { type: 'button', class: 'lien-bouton' }, ex.nom);
    b.addEventListener('click', () => {
      recherche.definir(ex.libelle);
      choisirAdresse({ libelle: ex.libelle, ...versLambert93(ex.lon, ex.lat) });
    });
    exemples.append(b, k < EXEMPLES.length - 1 ? ' · ' : '');
  });

  const ouvrirDepuisURL = (): void => {
    const m = /[#&]l=([A-Za-z0-9_-]+)/.exec(location.hash);
    const e = m ? decoderEtat(m[1]) : null;
    if (e?.adresse) {
      etat = e;
      recherche.definir(e.adresse.libelle);
      void chargerAdresse();
    } else if (m) {
      etatChargement('Ce lien de partage est incomplet ou endommagé. Recherchez l’adresse pour refaire le calcul.', true);
    }
  };
  window.addEventListener('hashchange', () => {
    const m = /[#&]l=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (m && m[1] !== (etat.adresse ? encoderEtat(etat) : '')) ouvrirDepuisURL();
  });
  ouvrirDepuisURL();
  // Sert aux tests de bout en bout et au diagnostic.
  (window as unknown as { pleinSoleil: unknown }).pleinSoleil = {
    etat: () => etat,
    resultat: () => resultat,
    scene: () => scene,
    /** Murs libres dès le rez-de-chaussée, du plus proche de l'adresse au plus lointain, avec leur position à l'écran. */
    murs: () => {
      if (!scene || !etat.adresse) return [];
      const { x, y } = etat.adresse;
      return scene.aretes
        .filter((a) => a.statut === 'libre' && a.etageMin === 0 && a.longueur > 6 && a.nbEtages >= 3)
        .map((a) => ({ x: (a.ax + a.bx) / 2, y: (a.ay + a.by) / 2, distance: Math.hypot((a.ax + a.bx) / 2 - x, (a.ay + a.by) / 2 - y), ecran: carte.versEcran((a.ax + a.bx) / 2, (a.ay + a.by) / 2) }))
        .sort((p, q) => p.distance - q.distance);
    },
  };
}
