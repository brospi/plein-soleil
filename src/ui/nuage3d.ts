/**
 * Nuage de points LiDAR HD dans la vue 3D : un objet three.js par nœud COPC,
 * gardé d'une zone à l'autre tant qu'il reste utile (la zone suit la caméra).
 *
 * Les points reçoivent les ombres portées : le relief maillé, masqué à l'écran,
 * continue de les projeter depuis la carte d'ombre du soleil.
 */
import * as THREE from 'three';
import { RAYON_NUAGE_MAX } from '../moteur/nuage';
import { type MessageNuage, type RequeteNuage } from '../moteur/protocole-nuage';

export interface EtatNuage {
  /** Points affichés, nœuds affichés et attendus. */
  points: number;
  noeuds: number;
  attendus: number;
  /** Points annoncés pour toute la zone. */
  pointsAttendus: number;
  dalles: number;
  termine: boolean;
  erreur: string | null;
  rayon: number;
}

/** Taille apparente d'un point (m) : l'écart entre points croît avec la distance au centre. */
const TAILLE_MIN = 0.45;
const TAILLE_MAX = 6;
const RECOUVREMENT = 1.5;

export class Nuage3D {
  readonly groupe = new THREE.Group();
  readonly materiau = new THREE.MeshLambertMaterial({ vertexColors: true });
  private worker: Worker | null = null;
  private objets = new Map<string, THREE.Points>();
  private voulus: Set<string> | null = null;
  private zone = 0;
  private centre = { x: 0, y: 0, z0: 0 };
  private uniformes = {
    uEchelle: { value: 1000 },
    uDensite: { value: RECOUVREMENT / 200 },
    uTailleMin: { value: TAILLE_MIN },
    uTailleMax: { value: TAILLE_MAX },
    uPhoto: { value: null as THREE.Texture | null },
    uRayonPhoto: { value: 0 },
    uAvecPhoto: { value: 0 },
  };
  etat: EtatNuage = { points: 0, noeuds: 0, attendus: 0, pointsAttendus: 0, dalles: 0, termine: false, erreur: null, rayon: 0 };
  /** Appelé à chaque nœud reçu, à la fin et en cas d'erreur. */
  surChange: () => void = () => {};

  constructor(private budget: number) {
    this.materiau.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.uniformes);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uEchelle;\nuniform float uDensite;\nuniform float uTailleMin;\nuniform float uTailleMax;\nvarying vec2 vSolNuage;')
        // Couleurs fournies en sRVB sur 8 bits : passage en linéaire, comme pour le maillage.
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = pow(vColor.rgb, vec3(2.2));')
        .replace(
          '#include <project_vertex>',
          [
            '#include <project_vertex>',
            'vec4 mondeNuage = modelMatrix * vec4(transformed, 1.0);',
            'vSolNuage = mondeNuage.xz;',
            'float tailleNuage = clamp(length(mondeNuage.xz) * uDensite, uTailleMin, uTailleMax);',
            'gl_PointSize = clamp(tailleNuage * uEchelle / max(-mvPosition.z, 0.1), 1.0, 40.0);',
          ].join('\n'),
        );
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uPhoto;\nuniform float uRayonPhoto;\nuniform float uAvecPhoto;\nvarying vec2 vSolNuage;')
        // Points ronds.
        .replace('void main() {', 'void main() {\nvec2 pcNuage = gl_PointCoord - 0.5;\nif (dot(pcNuage, pcNuage) > 0.25) discard;')
        .replace(
          '#include <color_fragment>',
          [
            '#include <color_fragment>',
            'if (uAvecPhoto > 0.5 && abs(vSolNuage.x) < uRayonPhoto && abs(vSolNuage.y) < uRayonPhoto) {',
            '  vec2 uvNuage = vec2(vSolNuage.x + uRayonPhoto, uRayonPhoto - vSolNuage.y) / (2.0 * uRayonPhoto);',
            '  diffuseColor.rgb = texture2D(uPhoto, uvNuage).rgb;',
            '}',
          ].join('\n'),
        );
    };
    this.materiau.customProgramCacheKey = () => 'nuage-lidar';
  }

  private demarrer(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../moteur/nuage.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<MessageNuage>) => this.recevoir(ev.data);
      this.worker.onerror = (ev) => {
        this.etat.erreur = `Le lecteur de nuage de points s’est arrêté : ${ev.message}`;
        this.surChange();
      };
    }
    return this.worker;
  }

  private envoyer(r: RequeteNuage): void {
    this.demarrer().postMessage(r);
  }

  /** Charge (ou complète) le nuage autour de (x, y) ; z0 est l'altitude du plan y = 0 de la vue. */
  charger(x: number, y: number, z0: number, rayon: number): void {
    this.centre = { x, y, z0 };
    for (const o of this.objets.values()) this.placer(o);
    this.zone++;
    this.voulus = null;
    const r = Math.min(rayon, RAYON_NUAGE_MAX);
    this.etat = { ...this.etat, attendus: 0, pointsAttendus: 0, termine: false, erreur: null, rayon: r };
    this.envoyer({ type: 'zone', zone: this.zone, x, y, rayon: r, budget: this.budget, presents: [...this.objets.keys()] });
    this.surChange();
  }

  /** Arrête les téléchargements en cours (les points déjà là restent). */
  arreter(): void {
    this.worker?.postMessage({ type: 'arreter' } satisfies RequeteNuage);
    this.zone++;
  }

  private placer(o: THREE.Points): void {
    const origine = o.userData.origine as { x: number; y: number };
    o.position.set(origine.x - this.centre.x, -this.centre.z0, -(origine.y - this.centre.y));
  }

  private retirer(cle: string): void {
    const o = this.objets.get(cle);
    if (!o) return;
    o.geometry.dispose();
    this.groupe.remove(o);
    this.objets.delete(cle);
  }

  private compter(): void {
    let points = 0;
    for (const o of this.objets.values()) points += o.geometry.getAttribute('position').count;
    this.etat.points = points;
    this.etat.noeuds = this.objets.size;
  }

  private recevoir(m: MessageNuage): void {
    if (m.type === 'noeud') {
      // Un nœud d'une zone précédente reste bon à prendre s'il sert encore.
      if (this.objets.has(m.cle) || (this.voulus && !this.voulus.has(m.cle))) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(m.couleurs, 3, true));
      g.setAttribute('normal', this.normales(m.positions.length / 3));
      g.computeBoundingSphere();
      const o = new THREE.Points(g, this.materiau);
      o.receiveShadow = true;
      o.userData = { origine: m.origine, niveau: m.niveau };
      this.placer(o);
      this.objets.set(m.cle, o);
      this.groupe.add(o);
      this.compter();
      this.surChange();
      return;
    }
    if (m.zone !== this.zone) return;
    if (m.type === 'selection') {
      this.voulus = new Set(m.cles);
      for (const cle of [...this.objets.keys()]) if (!this.voulus.has(cle)) this.retirer(cle);
      this.uniformes.uDensite.value = RECOUVREMENT / m.facteur;
      this.etat.attendus = m.cles.length;
      this.etat.pointsAttendus = m.points;
      this.etat.dalles = m.dalles;
      this.compter();
    } else if (m.type === 'fin') {
      this.etat.termine = true;
    } else {
      this.etat.erreur = m.message;
    }
    this.surChange();
  }

  /**
   * Un point n'a pas d'orientation : on l'éclaire comme un sol, le soleil compte
   * par sa hauteur. Sans attribut de normale, three.js calculerait des normales
   * « plates » à partir des dérivées à l'écran, nulles sur un point.
   * Un seul tampon, partagé et agrandi au besoin (WebGL tolère un tampon plus long).
   */
  private normalesPartagees: THREE.BufferAttribute | null = null;
  private normales(n: number): THREE.BufferAttribute {
    if (!this.normalesPartagees || this.normalesPartagees.count < n) {
      const a = new Int8Array(Math.max(n, 65_536) * 3);
      for (let i = 1; i < a.length; i += 3) a[i] = 127;
      this.normalesPartagees = new THREE.BufferAttribute(a, 3, true);
    }
    return this.normalesPartagees;
  }

  /** Nombre de pixels par mètre à un mètre de distance : hauteur de l'image (pixels physiques) et champ vertical. */
  majEchelle(hauteurPixels: number, champDegres: number): void {
    this.uniformes.uEchelle.value = hauteurPixels / (2 * Math.tan((champDegres * Math.PI) / 360));
  }

  /** Photo aérienne plaquée par le dessus, comme sur le maillage, ou couleurs de classe. */
  definirPhoto(texture: THREE.Texture | null, rayon: number): void {
    this.uniformes.uPhoto.value = texture;
    this.uniformes.uRayonPhoto.value = rayon;
    this.uniformes.uAvecPhoto.value = texture ? 1 : 0;
  }

  /** Part des nœuds reçus (0 à 1). */
  get avancement(): number {
    return this.etat.attendus ? Math.min(1, this.etat.noeuds / this.etat.attendus) : 0;
  }
}
