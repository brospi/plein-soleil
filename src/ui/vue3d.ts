/**
 * Vue 3D : modèle de surface LiDAR maillé (murs verticaux), ombres portées
 * selon la date et l'heure, sélection de la fenêtre directement sur la façade.
 * Module chargé à la demande (three.js).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { type Moteur } from '../moteur/client';
import { type InfoScene, type ResultatMaillage } from '../moteur/protocole';
import { type Maillage } from '../coeur/maillage';
import { ANNEE_TYPE, dateDuJour, positionSoleil, utcDepuisHeureLegale } from '../coeur/soleil';
import { COUCHE_ORTHO_WMS, urlImage } from '../donnees/ign';
import { dateLongue, heureDuJour, parId } from './outils';

export interface PointMur {
  x: number;
  y: number;
  /** Altitude NGF du point touché. */
  altitude: number;
  /** Normale horizontale du mur (repère Lambert). */
  nx: number;
  ny: number;
}

interface Observation {
  x: number;
  y: number;
  z: number;
  az: number;
  largeur: number;
  hauteur: number;
  actif: boolean;
}

const RAD = Math.PI / 180;

/** Table sRGB → linéaire : les couleurs de sommets sont attendues en linéaire. */
const LINEAIRE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAIRE[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function melanger(a: number, b: number, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)));
}

export class Vue3D {
  private rendu: THREE.WebGLRenderer;
  private scene3 = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 1, 6000);
  private commandes: OrbitControls;
  private soleil = new THREE.DirectionalLight(0xffffff, 3);
  private ciel = new THREE.HemisphereLight(0xcfe2f7, 0x8a8273, 1);
  private maillages = new THREE.Group();
  private marqueurs = new THREE.Group();
  private matToits = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  private matMurs = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  private proche: THREE.Mesh | null = null;
  private texture: THREE.Texture | null = null;
  private infos: ResultatMaillage | null = null;
  private renduDemande = false;
  private jour = 171;
  private minutes = 14 * 60;
  private lecture = false;
  private mobile = window.matchMedia('(max-width: 700px)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;
  sceneCourante: InfoScene | null = null;
  surMur: (p: PointMur) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private moteur: Moteur,
  ) {
    this.rendu = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.rendu.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.rendu.shadowMap.enabled = true;
    this.rendu.shadowMap.type = THREE.PCFShadowMap;
    this.rendu.toneMapping = THREE.ACESFilmicToneMapping;
    this.rendu.toneMappingExposure = 0.95;

    this.soleil.castShadow = true;
    const taille = this.mobile ? 2048 : Math.min(4096, this.rendu.capabilities.maxTextureSize);
    this.soleil.shadow.mapSize.set(taille, taille);
    this.soleil.shadow.bias = -0.0004;
    this.soleil.shadow.normalBias = 0.35;
    this.soleil.shadow.radius = 2.5;
    this.scene3.add(this.soleil, this.soleil.target, this.ciel, this.maillages, this.marqueurs);

    this.commandes = new OrbitControls(this.camera, canvas);
    this.commandes.enableDamping = true;
    this.commandes.dampingFactor = 0.12;
    this.commandes.maxPolarAngle = 88 * RAD;
    this.commandes.minDistance = 6;
    this.commandes.maxDistance = 900;
    this.commandes.addEventListener('change', () => this.demanderRendu());

    new ResizeObserver(() => this.redimensionner()).observe(canvas.parentElement!);
    this.installerClic();
    this.installerCommandes();
    this.redimensionner();
  }

  /* ---------- Rendu à la demande ---------- */
  private demanderRendu(): void {
    if (this.renduDemande) return;
    this.renduDemande = true;
    requestAnimationFrame(() => {
      this.renduDemande = false;
      if (this.lecture) this.avancer();
      this.commandes.update();
      this.rendu.render(this.scene3, this.camera);
      if (this.lecture) this.demanderRendu();
    });
  }

  redimensionner(): void {
    const parent = this.canvas.parentElement!;
    const l = parent.clientWidth;
    const h = parent.clientHeight;
    if (l < 10 || h < 10) return;
    this.rendu.setSize(l, h, false);
    this.camera.aspect = l / h;
    this.camera.updateProjectionMatrix();
    this.demanderRendu();
  }

  /* ---------- Scène ---------- */
  private geometrie(m: Maillage, rayonTexture: number): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normales, 3, true));
    const n = m.couleurs.length;
    const couleurs = new Float32Array(n);
    for (let i = 0; i < n; i++) couleurs[i] = LINEAIRE[m.couleurs[i]];
    g.setAttribute('color', new THREE.BufferAttribute(couleurs, 3));
    // Coordonnées de texture : projection verticale de la photo aérienne.
    const uv = new Float32Array((m.positions.length / 3) * 2);
    for (let i = 0, j = 0; i < m.positions.length; i += 3, j += 2) {
      uv[j] = (m.positions[i] + rayonTexture) / (2 * rayonTexture);
      uv[j + 1] = (rayonTexture - m.positions[i + 2]) / (2 * rayonTexture);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const indices = new Uint32Array(m.indicesToits.length + m.indicesMurs.length);
    indices.set(m.indicesToits);
    indices.set(m.indicesMurs, m.indicesToits.length);
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.addGroup(0, m.indicesToits.length, 0);
    g.addGroup(m.indicesToits.length, m.indicesMurs.length, 1);
    g.computeBoundingSphere();
    return g;
  }

  async chargerScene(scene: InfoScene, centre: { x: number; y: number; az: number | null }): Promise<void> {
    const rayon = this.mobile ? 90 : 150;
    const rayonLointain = this.mobile ? 260 : 460;
    const r = await this.moteur.maillage({ x: centre.x, y: centre.y, rayon, rayonLointain });
    this.sceneCourante = scene;
    this.infos = r;
    for (const enfant of [...this.maillages.children]) {
      (enfant as THREE.Mesh).geometry.dispose();
      this.maillages.remove(enfant);
    }
    this.texture?.dispose();
    this.texture = null;
    this.appliquerTexture(false);
    parId('v3-texture').setAttribute('aria-pressed', 'false');

    this.proche = new THREE.Mesh(this.geometrie(r.proche, rayon), [this.matToits, this.matMurs]);
    this.proche.castShadow = true;
    this.proche.receiveShadow = true;
    this.maillages.add(this.proche);
    if (r.lointain) {
      // Le pourtour garde ses couleurs de classe (pas de photo) et ne projette pas d'ombre.
      const matLoin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
      const loin = new THREE.Mesh(this.geometrie(r.lointain, rayonLointain), [matLoin, matLoin]);
      loin.receiveShadow = true;
      this.maillages.add(loin);
    }
    // Volume d'ombre : toute la zone proche.
    const cam = this.soleil.shadow.camera;
    const demi = rayon * 1.45;
    cam.left = -demi;
    cam.right = demi;
    cam.top = demi;
    cam.bottom = -demi;
    cam.near = 10;
    cam.far = rayon * 8;
    cam.updateProjectionMatrix();
    this.recentrer(centre.az);
    this.majSoleil();
  }

  /** Place la caméra face à la façade étudiée (ou en vue d'ensemble). */
  recentrer(az: number | null = null): void {
    const cible = new THREE.Vector3(0, 10, 0);
    const actif = this.marqueurs.children.find((m) => m.userData.actif);
    if (actif) cible.copy(actif.position);
    const a = ((az ?? (actif?.userData.az as number | undefined) ?? 200) + 28) * RAD;
    const d = this.mobile ? 95 : 110;
    this.camera.position.set(cible.x + Math.sin(a) * d, cible.y + d * 0.62, cible.z - Math.cos(a) * d);
    this.commandes.target.copy(cible);
    this.commandes.update();
    this.demanderRendu();
  }

  definirFenetres(observations: Observation[]): void {
    for (const enfant of [...this.marqueurs.children]) this.marqueurs.remove(enfant);
    if (!this.infos) return;
    for (const o of observations) {
      const a = o.az * RAD;
      const n = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
      const groupe = new THREE.Group();
      const couleur = o.actif ? 0xffb000 : 0x9a9488;
      const vitre = new THREE.Mesh(new THREE.PlaneGeometry(o.largeur, o.hauteur), new THREE.MeshBasicMaterial({ color: couleur, side: THREE.DoubleSide, toneMapped: false }));
      const cadre = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(o.largeur + 0.25, o.hauteur + 0.25)), new THREE.LineBasicMaterial({ color: 0xffffff, toneMapped: false }));
      groupe.add(vitre, cadre);
      // Repère visible de loin : une tige et une pastille au-dessus de la fenêtre.
      const tige = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5), new THREE.MeshBasicMaterial({ color: couleur, toneMapped: false }));
      tige.rotation.x = Math.PI / 2;
      tige.position.set(0, 0, 2.5);
      const pastille = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshBasicMaterial({ color: couleur, toneMapped: false }));
      pastille.position.set(0, 0, 5);
      groupe.add(tige, pastille);
      if (o.actif) {
        // Balise verticale, visible même quand la fenêtre est au fond d'une cour.
        const hauteurBalise = 45;
        const mat = new THREE.MeshBasicMaterial({ color: couleur, toneMapped: false, depthTest: false, transparent: true, opacity: 0.85 });
        const fil = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, hauteurBalise), mat);
        fil.position.set(0, hauteurBalise / 2, 0.5);
        fil.renderOrder = 10;
        const tete = new THREE.Mesh(new THREE.SphereGeometry(1.3, 20, 14), mat);
        tete.position.set(0, hauteurBalise, 0.5);
        tete.renderOrder = 10;
        groupe.add(fil, tete);
      }
      // Le point d'observation est 50 cm devant le mur : on plaque le vitrage 10 cm devant.
      groupe.position.set(o.x - this.infos.x - n.x * 0.4, o.z - this.infos.z0, -(o.y - this.infos.y) - n.z * 0.4);
      groupe.rotation.y = Math.atan2(n.x, n.z);
      groupe.userData = { actif: o.actif, az: o.az };
      this.marqueurs.add(groupe);
    }
    this.demanderRendu();
  }

  /* ---------- Soleil ---------- */
  definirJour(jour: number): void {
    this.jour = jour;
    parId<HTMLInputElement>('v3-date').value = String(jour);
    this.majSoleil();
  }

  private majSoleil(): void {
    parId('v3-date-texte').textContent = dateLongue(this.jour);
    parId('v3-heure-texte').textContent = heureDuJour(this.minutes);
    const s = this.sceneCourante;
    if (!s) return;
    const { mois, jour } = dateDuJour(this.jour);
    const p = positionSoleil(utcDepuisHeureLegale(ANNEE_TYPE, mois, jour, 0, 0) + this.minutes * 60_000, s.lat, s.lon);
    const az = (p.azimut - s.convergence) * RAD;
    const el = Math.max(p.hauteur, -8) * RAD;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const portee = (this.infos?.rayon ?? 150) * 3.2;
    this.soleil.position.copy(dir).multiplyScalar(portee);
    this.soleil.target.position.set(0, 0, 0);
    // Lumière : chaude et faible près de l'horizon, nulle la nuit.
    const h = p.hauteur;
    const jourT = Math.max(0, Math.min(1, h / 12));
    this.soleil.intensity = h > 0 ? 0.5 + 2.1 * Math.min(1, h / 25) : 0;
    this.soleil.color.copy(melanger(0xffb070, 0xfff4e0, h / 20));
    this.soleil.castShadow = h > 0.5;
    this.ciel.intensity = 0.14 + 0.85 * Math.max(0, Math.min(1, (h + 6) / 18));
    this.ciel.color.copy(melanger(0x2a3350, 0xcfe2f7, (h + 6) / 14));
    const fond = h > 0 ? melanger(0xf3c9a2, 0xbcd9f2, jourT) : melanger(0x0d1020, 0xf3c9a2, (h + 8) / 8);
    this.scene3.background = fond;
    this.demanderRendu();
  }

  private avancer(): void {
    this.minutes += 3;
    if (this.minutes > 1320) this.minutes = 240;
    parId<HTMLInputElement>('v3-heure').value = String(this.minutes);
    this.majSoleil();
  }

  private installerCommandes(): void {
    const date = parId<HTMLInputElement>('v3-date');
    const heure = parId<HTMLInputElement>('v3-heure');
    date.value = String(this.jour);
    heure.value = String(this.minutes);
    date.addEventListener('input', () => {
      this.jour = Number(date.value);
      this.majSoleil();
    });
    heure.addEventListener('input', () => {
      this.minutes = Number(heure.value);
      this.majSoleil();
    });
    const lecture = parId('v3-lecture');
    lecture.addEventListener('click', () => {
      this.lecture = !this.lecture;
      lecture.setAttribute('aria-pressed', String(this.lecture));
      lecture.textContent = this.lecture ? '❚❚ Arrêter' : '▶ Animer la journée';
      this.demanderRendu();
    });
    const texture = parId('v3-texture');
    texture.addEventListener('click', () => {
      const active = texture.getAttribute('aria-pressed') !== 'true';
      texture.setAttribute('aria-pressed', String(active));
      void this.chargerTexture(active);
    });
    parId('v3-recentrer').addEventListener('click', () => this.recentrer());
  }

  /* ---------- Photo aérienne plaquée sur les toits et le sol ---------- */
  private appliquerTexture(active: boolean): void {
    this.matToits.map = active ? this.texture : null;
    this.matToits.vertexColors = !active;
    this.matToits.needsUpdate = true;
    this.demanderRendu();
  }

  private async chargerTexture(active: boolean): Promise<void> {
    if (!active || !this.infos) {
      this.appliquerTexture(false);
      return;
    }
    if (!this.texture) {
      const { x, y, rayon } = this.infos;
      const url = urlImage(COUCHE_ORTHO_WMS, { x0: x - rayon, y1: y + rayon, pas: 1, largeur: 2 * rayon, hauteur: 2 * rayon }, 'image/jpeg', 2048, 2048);
      try {
        const chargeur = new THREE.TextureLoader();
        chargeur.setCrossOrigin('anonymous');
        this.texture = await chargeur.loadAsync(url);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = this.rendu.capabilities.getMaxAnisotropy();
      } catch {
        parId('v3-texture').setAttribute('aria-pressed', 'false');
        const message = parId('vue3d-message');
        message.hidden = false;
        message.textContent = 'La photo aérienne de l’IGN n’a pas pu être chargée.';
        setTimeout(() => (message.hidden = true), 4000);
        return;
      }
    }
    this.appliquerTexture(true);
  }

  /* ---------- Sélection d'une façade ---------- */
  private installerClic(): void {
    let depart: { x: number; y: number; t: number } | null = null;
    this.canvas.addEventListener('pointerdown', (ev) => {
      depart = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    });
    this.canvas.addEventListener('pointerup', (ev) => {
      if (!depart || !this.proche || !this.infos) return;
      const immobile = Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y) < 6 && performance.now() - depart.t < 600;
      depart = null;
      if (!immobile) return;
      const r = this.canvas.getBoundingClientRect();
      const souris = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      const rayon = new THREE.Raycaster();
      rayon.setFromCamera(souris, this.camera);
      const touche = rayon.intersectObject(this.proche, false)[0];
      if (!touche || !touche.face) return;
      const n = touche.face.normal.clone();
      if (n.dot(rayon.ray.direction) > 0) n.negate();
      if (Math.abs(n.y) > 0.35) return; // toit ou sol : pas une façade
      const norme = Math.hypot(n.x, n.z) || 1;
      this.surMur({
        x: this.infos.x + touche.point.x,
        y: this.infos.y - touche.point.z,
        altitude: this.infos.z0 + touche.point.y,
        nx: n.x / norme,
        ny: -n.z / norme,
      });
    });
  }
}
