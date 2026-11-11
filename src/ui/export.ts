/** Exports : fiche PDF d'un logement et tableau CSV jour par jour. */
import { dateDuJour, ANNEE_TYPE } from '../coeur/soleil';
import { type Indicateurs } from '../coeur/simulation';
import { duree, nombre, pourcent, telecharger } from './outils';

export interface ContenuFiche {
  adresse: string;
  description: string;
  indicateurs: Indicateurs;
  avertissements: string[];
  /** Graphiques rendus en thème clair, avec leur titre. */
  graphiques: Array<{ titre: string; image: HTMLCanvasElement }>;
  facades: { entetes: string[]; lignes: string[][] } | null;
  etages: { entetes: string[]; lignes: string[][] } | null;
  lien: string;
}

/** Les polices standard du PDF ne couvrent que Windows-1252 : on remplace le reste. */
const ESPACES_FINES = new RegExp('[\\u202f\\u00a0\\u2009]', 'g');
const HORS_CP1252 = new RegExp('[^\\u0020-\\u00ff\\u2018\\u2019\\u201c\\u201d\\u2013\\u2014\\u2026\\u0152\\u0153\\u20ac]', 'g');

function sur(texte: string): string {
  return texte.replace(ESPACES_FINES, ' ').replace(/−/g, '-').replace(/≈/g, 'env. ').replace(/≥/g, '>=').replace(HORS_CP1252, '');
}

function nomFichier(adresse: string, extension: string): string {
  const base = adresse
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `plein-soleil-${base || 'logement'}.${extension}`;
}

export async function exporterPdf(c: ContenuFiche): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 210;
  const M = 14;
  let y = 16;
  const sautSiBesoin = (h: number): void => {
    if (y + h > 283) {
      doc.addPage();
      y = 16;
    }
  };
  // En-tête.
  doc.setFillColor(232, 156, 0);
  doc.circle(M + 3.5, y - 1.5, 3.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(31, 28, 22);
  doc.text('Plein Soleil', M + 10, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(95, 89, 76);
  doc.text(sur('Fiche d’ensoleillement — année type, ciel clair'), L - M, y, { align: 'right' });
  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(31, 28, 22);
  const titre = doc.splitTextToSize(sur(c.adresse), L - 2 * M) as string[];
  doc.text(titre, M, y);
  y += titre.length * 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(95, 89, 76);
  const desc = doc.splitTextToSize(sur(c.description), L - 2 * M) as string[];
  doc.text(desc, M, y);
  y += desc.length * 4.6 + 4;

  // Indicateurs : grille 4 × 2.
  const i = c.indicateurs;
  const cases: Array<[string, string]> = [
    ['Soleil direct par an', `${nombre(i.heuresAn)} h`],
    ['Part du maximum possible', pourcent(i.partDuMaximum)],
    ['Moyenne par jour', duree(i.moyenneJour)],
    ['Jours sans soleil', String(i.joursSansSoleil)],
    ['Hiver (déc.-févr.), par jour', duree(i.moyenneHiver)],
    ['Été (juin-août), par jour', duree(i.moyenneEte)],
    ['Énergie directe, ciel clair', `${nombre(i.energieAn)} kWh/m²/an`],
    ['Ciel visible', pourcent(i.cielVisible)],
  ];
  const lc = (L - 2 * M - 9) / 4;
  cases.forEach(([nom, valeur], k) => {
    const cx = M + (k % 4) * (lc + 3);
    const cy = y + Math.floor(k / 4) * 19;
    doc.setFillColor(k === 0 ? 255 : 241, k === 0 ? 243 : 237, k === 0 ? 214 : 228);
    doc.roundedRect(cx, cy, lc, 16, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(95, 89, 76);
    doc.text(sur(nom), cx + 3, cy + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(31, 28, 22);
    doc.text(sur(valeur), cx + 3, cy + 12);
  });
  y += 42;

  for (const a of c.avertissements) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(140, 60, 20);
    const lignes = doc.splitTextToSize(sur(a), L - 2 * M) as string[];
    sautSiBesoin(lignes.length * 4 + 2);
    doc.text(lignes, M, y);
    y += lignes.length * 4 + 2;
  }

  for (const g of c.graphiques) {
    const h = ((L - 2 * M) * g.image.height) / g.image.width;
    sautSiBesoin(h + 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(31, 28, 22);
    doc.text(sur(g.titre), M, y + 3);
    y += 6;
    doc.addImage(g.image.toDataURL('image/png'), 'PNG', M, y, L - 2 * M, h, undefined, 'FAST');
    y += h + 6;
  }

  const tableau = (titreTableau: string, t: { entetes: string[]; lignes: string[][] }): void => {
    sautSiBesoin(12 + t.lignes.length * 5.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(31, 28, 22);
    doc.text(sur(titreTableau), M, y + 3);
    y += 8;
    const n = t.entetes.length;
    const premiere = 40;
    const autre = (L - 2 * M - premiere) / (n - 1);
    const X = (k: number): number => (k === 0 ? M : M + premiere + autre * k);
    doc.setFontSize(7.5);
    doc.setTextColor(95, 89, 76);
    t.entetes.forEach((e, k) => doc.text(sur(e), X(k), y, { align: k === 0 ? 'left' : 'right' }));
    y += 1.5;
    doc.setDrawColor(201, 193, 176);
    doc.line(M, y, L - M, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(31, 28, 22);
    for (const l of t.lignes) {
      l.forEach((v, k) => doc.text(sur(v), X(k), y, { align: k === 0 ? 'left' : 'right' }));
      y += 5.2;
    }
    y += 4;
  };
  if (c.facades) tableau('Façades du logement', c.facades);
  if (c.etages) tableau('Comparaison par étage', c.etages);

  sautSiBesoin(30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(95, 89, 76);
  const pied = doc.splitTextToSize(
    sur(
      'Méthode : position du soleil toutes les 2 minutes sur une année type (algorithme NOAA), masque d’horizon par lancer de rayons sur le LiDAR HD de l’IGN (50 cm), rayonnement direct par ciel clair (modèle ESRA). ' +
        'Les heures indiquées sont un potentiel par ciel clair, sans météo : elles servent à comparer des logements. Résultat indicatif, sans valeur contractuelle. ' +
        'Données : © IGN (LiDAR HD, BD TOPO, Géoplateforme), licence Ouverte Etalab 2.0.',
    ),
    L - 2 * M,
  ) as string[];
  doc.text(pied, M, y);
  y += pied.length * 3.4 + 2;
  doc.setTextColor(184, 110, 0);
  const lien = c.lien.length > 110 ? `${c.lien.slice(0, 107)}...` : c.lien;
  doc.textWithLink(sur(`Rouvrir ce calcul : ${lien}`), M, y, { url: c.lien });
  doc.save(nomFichier(c.adresse, 'pdf'));
}

export interface ContenuCsv {
  adresse: string;
  description: string;
  heures: Float32Array;
  plein: Float32Array;
  reference: Float32Array;
  energie: Float32Array;
}

/** CSV au format français (point-virgule, virgule décimale, UTF-8 avec BOM pour Excel). */
export function construireCsv(c: ContenuCsv): string {
  const fr = (v: number, d = 2): string => v.toFixed(d).replace('.', ',');
  const guillemets = (s: string): string => `"${s.replace(/"/g, '""')}"`;
  const lignes = [
    `Plein Soleil;${guillemets(c.adresse)}`,
    `Fenêtre;${guillemets(c.description)}`,
    'Hypothèses;"Année type 2026, ciel clair, heure légale française"',
    '',
    'Date;Soleil direct (h);Plein soleil (h);Façade dégagée (h);Énergie directe (Wh/m²)',
  ];
  for (let j = 0; j < c.heures.length; j++) {
    const { mois, jour } = dateDuJour(j);
    const date = `${String(jour).padStart(2, '0')}/${String(mois).padStart(2, '0')}/${ANNEE_TYPE}`;
    lignes.push([date, fr(c.heures[j]), fr(c.plein[j]), fr(c.reference[j]), fr(c.energie[j], 0)].join(';'));
  }
  return lignes.join('\r\n') + '\r\n';
}

export function exporterCsv(c: ContenuCsv): void {
  telecharger(nomFichier(c.adresse, 'csv'), new Blob(['﻿', construireCsv(c)], { type: 'text/csv;charset=utf-8' }));
}
