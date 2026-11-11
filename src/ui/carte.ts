/**
 * Carte : fonds IGN, emprises des bâtiments, murs sélectionnables.
 * Un clic sur (ou près d')un mur libre place la fenêtre ; la normale
 * extérieure est celle de l'arête.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { depuisLambert93, versLambert93 } from '../coeur/lambert93';
import { type Arete, areteLaPlusProche, azimutDe } from '../coeur/facades';
import { type InfoScene } from '../moteur/protocole';
import { urlTuiles } from '../donnees/ign';
import { type FenetreEtat } from './etat';

const ATTRIBUTION = '© <a href="https://geoservices.ign.fr/" target="_blank" rel="noopener">IGN</a>';

export interface ChoixMur {
  x: number;
  y: number;
  /** Azimut « grille » de la normale. */
  az: number;
  arete: Arete;
}

export class Carte {
  private carte: L.Map;
  private plan: L.TileLayer;
  private photo: L.TileLayer;
  private couches = L.layerGroup();
  private marqueurs = L.layerGroup();
  private survol: L.Polyline;
  private scene: InfoScene | null = null;
  surMur: (c: ChoixMur) => void = () => {};
  surMurRefuse: () => void = () => {};

  constructor(conteneur: HTMLElement) {
    this.carte = L.map(conteneur, { zoomControl: true, attributionControl: true, maxZoom: 21, minZoom: 5, zoomSnap: 0.5 }).setView([46.6, 2.4], 6);
    this.carte.attributionControl.setPrefix(false);
    this.plan = L.tileLayer(urlTuiles('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxNativeZoom: 19, maxZoom: 21, attribution: ATTRIBUTION }).addTo(this.carte);
    this.photo = L.tileLayer(urlTuiles('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { maxNativeZoom: 19, maxZoom: 21, attribution: ATTRIBUTION });
    this.couches.addTo(this.carte);
    this.marqueurs.addTo(this.carte);
    this.survol = L.polyline([], { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(this.carte);

    this.carte.on('click', (ev) => {
      const proche = this.murProche(ev.latlng, 16);
      if (proche) this.surMur(proche);
      else if (this.scene && this.murProche(ev.latlng, 16, true)) this.surMurRefuse();
    });
    this.carte.on('mousemove', (ev) => {
      const proche = this.murProche(ev.latlng, 12);
      if (proche) {
        const a = proche.arete;
        this.survol.setLatLngs([this.latLng(a.ax, a.ay), this.latLng(a.bx, a.by)]);
        this.carte.getContainer().style.cursor = 'pointer';
      } else {
        this.survol.setLatLngs([]);
        this.carte.getContainer().style.cursor = '';
      }
    });
  }

  private latLng(x: number, y: number): L.LatLngExpression {
    const g = depuisLambert93(x, y);
    return [g.lat, g.lon];
  }

  /** Mur libre le plus proche d'un point, dans une tolérance exprimée en pixels. */
  private murProche(ll: L.LatLng, pixels: number, mitoyens = false): ChoixMur | null {
    if (!this.scene) return null;
    const metresParPixel = (40075016.686 * Math.cos((ll.lat * Math.PI) / 180)) / 2 ** (this.carte.getZoom() + 8);
    const p = versLambert93(ll.lng, ll.lat);
    const r = areteLaPlusProche(this.scene.aretes, p.x, p.y, Math.max(1.5, pixels * metresParPixel), (a) => (mitoyens ? a.statut === 'mitoyen' : a.statut === 'libre'));
    return r ? { x: r.x, y: r.y, az: azimutDe(r.arete.nx, r.arete.ny), arete: r.arete } : null;
  }

  basculerFond(photo: boolean): void {
    if (photo) {
      this.carte.removeLayer(this.plan);
      this.photo.addTo(this.carte);
    } else {
      this.carte.removeLayer(this.photo);
      this.plan.addTo(this.carte);
    }
    this.photo.bringToBack();
    this.plan.bringToBack();
  }

  centrer(x: number, y: number, zoom = 19): void {
    this.carte.setView(this.latLng(x, y), zoom);
  }

  /** Position à l'écran (pixels dans le conteneur de la carte) d'un point Lambert 93. */
  versEcran(x: number, y: number): { x: number; y: number } {
    const p = this.carte.latLngToContainerPoint(this.latLng(x, y));
    return { x: p.x, y: p.y };
  }

  /** À appeler quand le conteneur change de taille ou redevient visible. */
  redimensionner(): void {
    this.carte.invalidateSize();
  }

  afficherScene(scene: InfoScene | null): void {
    this.scene = scene;
    this.couches.clearLayers();
    this.survol.setLatLngs([]);
    if (!scene) return;
    const rendu = L.canvas({ padding: 0.3 });
    const polygones = scene.batiments.map((b) => {
      const anneaux: L.LatLngExpression[][] = b.anneaux.map((a) => {
        const pts: L.LatLngExpression[] = [];
        for (let i = 0; i < a.pts.length; i += 2) pts.push(this.latLng(a.pts[i], a.pts[i + 1]));
        return pts;
      });
      return anneaux;
    });
    L.polygon(polygones, { renderer: rendu, stroke: false, fillColor: '#3a3327', fillOpacity: 0.16, interactive: false }).addTo(this.couches);
    const segments = (filtre: (a: Arete) => boolean): L.LatLngExpression[][] => scene.aretes.filter(filtre).map((a) => [this.latLng(a.ax, a.ay), this.latLng(a.bx, a.by)]);
    L.polyline(segments((a) => a.statut !== 'libre'), { renderer: rendu, color: '#7d766a', weight: 1.5, opacity: 0.9, dashArray: '3 4', interactive: false }).addTo(this.couches);
    // Murs dégagés seulement en partie haute (au-dessus d'un voisin plus bas) : trait fin.
    L.polyline(segments((a) => a.statut === 'libre' && a.etageMin > 0), { renderer: rendu, color: '#e07b00', weight: 1.8, opacity: 0.9, interactive: false }).addTo(this.couches);
    L.polyline(segments((a) => a.statut === 'libre' && a.etageMin === 0), { renderer: rendu, color: '#e07b00', weight: 4, opacity: 0.95, lineCap: 'round', interactive: false }).addTo(this.couches);
  }

  afficherFenetres(fenetres: FenetreEtat[], actif: number): void {
    this.marqueurs.clearLayers();
    fenetres.forEach((f, i) => {
      const a = (f.az * Math.PI) / 180;
      // Flèche : direction dans laquelle regarde la fenêtre (normale extérieure).
      const pt = (avance: number, cote: number): L.LatLngExpression => this.latLng(f.x + Math.sin(a) * avance + Math.cos(a) * cote, f.y + Math.cos(a) * avance - Math.sin(a) * cote);
      const couleur = i === actif ? '#1f1c16' : '#6f695d';
      L.polyline([pt(0, 0), pt(9, 0)], { color: '#ffffff', weight: 6, interactive: false }).addTo(this.marqueurs);
      L.polyline([[pt(0, 0), pt(9, 0)], [pt(6.5, -1.8), pt(9, 0), pt(6.5, 1.8)]], { color: couleur, weight: 3, interactive: false }).addTo(this.marqueurs);
      L.marker(this.latLng(f.x, f.y), {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: '', html: `<div class="marqueur-fenetre${i === actif ? '' : ' marqueur-fenetre--inactif'}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).addTo(this.marqueurs);
    });
  }
}
