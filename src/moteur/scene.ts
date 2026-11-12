/**
 * Chargement d'une scène : relief multi-résolution, classes, emprises bâties.
 * Les accès réseau sont injectés pour que le module reste testable hors navigateur.
 */
import { type Raster, decoderBil, partSansDonnee, reechantillonner, creerRaster } from '../coeur/raster';
import { construireSurfaces, decoderClasses } from '../coeur/classification';
import { type Niveau } from '../coeur/horizon';
import {
  type Batiment,
  type Arete,
  type Relief,
  anneauxDepuisGeoJSON,
  aretesDuBatiment,
  classerAretes,
  extruderBatiments,
  hauteurEstimee,
  type ParametresEtages,
} from '../coeur/facades';
import { type Emprise, COUCHE_CLASSES, COUCHE_MNS, COUCHE_MNT, COUCHE_RGE_ALTI, empriseCalee, urlAltitudes, urlBatiments, urlImage } from '../donnees/ign';

export interface Acces {
  /**
   * Tampon binaire (mis en cache). `facultatif` : couche dont on peut se passer
   * (relief lointain, classes) ; elle a droit à moins de patience pour ne pas
   * retarder le premier résultat quand le service traîne.
   */
  binaire(url: string, service: string, facultatif?: boolean): Promise<ArrayBuffer>;
  /** Image décodée en RGBA (mise en cache). */
  image(url: string, largeur: number, hauteur: number, service: string, facultatif?: boolean): Promise<Uint8ClampedArray | Uint8Array>;
  json(url: string, service: string): Promise<unknown>;
}

export type ModeRelief = 'lidar' | 'bdtopo';

export interface SceneChargee {
  mode: ModeRelief;
  niveaux: Niveau[];
  relief: Relief;
  /** MNS fin d'origine (végétation comprise), pour la vue 3D. */
  mns: Raster;
  classes: Uint8Array;
  /** Niveau intermédiaire (2 m) pour le pourtour de la vue 3D. */
  mnsMoyen: Raster | null;
  classesMoyen: Uint8Array | null;
  batiments: Batiment[];
  aretes: Arete[];
  avertissements: string[];
  /** Part de bâtiments sans hauteur fiable (mode BD TOPO). */
  hauteursIncertaines: number;
}

const SERVICE_ALTI = 'd’altimétrie LiDAR HD de l’IGN';
const SERVICE_BDTOPO = 'BD TOPO de l’IGN';

interface FeatureBati {
  id?: string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
}

export async function chargerBatiments(acces: Acces, x0: number, y0: number, x1: number, y1: number): Promise<Batiment[]> {
  const batiments: Batiment[] = [];
  const PAGE = 1000;
  for (let debut = 0; debut < 6000; debut += PAGE) {
    const geo = (await acces.json(urlBatiments(x0, y0, x1, y1, debut, PAGE), SERVICE_BDTOPO)) as { features?: FeatureBati[] };
    const features = geo.features ?? [];
    for (const f of features) {
      if (!f.geometry) continue;
      const anneaux = anneauxDepuisGeoJSON(f.geometry);
      if (!anneaux.length) continue;
      const p = f.properties;
      batiments.push({
        id: String(p.cleabs ?? f.id ?? batiments.length),
        anneaux,
        hauteur: typeof p.hauteur === 'number' && p.hauteur > 0 ? p.hauteur : null,
        etages: typeof p.nombre_d_etages === 'number' && p.nombre_d_etages > 0 ? p.nombre_d_etages : null,
        usage: typeof p.usage_1 === 'string' ? p.usage_1 : null,
      });
    }
    if (features.length < PAGE) break;
  }
  return batiments;
}

function versRaster(tampon: ArrayBuffer, e: Emprise): Raster {
  return decoderBil(tampon, e.x0, e.y1, e.pas, e.largeur, e.hauteur);
}

/** Remplace les cellules sans donnée par une valeur très basse (aucun obstacle). */
function boucherTrous(r: Raster, valeur = -500): void {
  for (let i = 0; i < r.d.length; i++) if (!(r.d[i] > -1000)) r.d[i] = valeur;
}

export async function chargerScene(
  x: number,
  y: number,
  acces: Acces,
  etages: ParametresEtages,
  progression: (message: string) => void = () => {},
): Promise<SceneChargee> {
  const e0 = empriseCalee(x, y, 0.5, 1024, 32);
  const e1 = empriseCalee(x, y, 2, 1024, 128);
  const e2 = empriseCalee(x, y, 8, 1024, 512);
  const eMnt0: Emprise = { ...e0, pas: 1, largeur: 512, hauteur: 512 };
  const eMnt1: Emprise = { ...e1, pas: 4, largeur: 512, hauteur: 512 };
  const avertissements: string[] = [];

  progression('Téléchargement du relief LiDAR HD et des bâtiments…');
  const RAYON_BATI = 160;
  const pBati = chargerBatiments(acces, x - RAYON_BATI, y - RAYON_BATI, x + RAYON_BATI, y + RAYON_BATI);
  const pMns0 = acces.binaire(urlAltitudes(COUCHE_MNS, e0), SERVICE_ALTI);
  // Les autres couches partent tout de suite ; elles ne servent que si le LiDAR existe ici.
  const suite = Promise.allSettled([
    acces.binaire(urlAltitudes(COUCHE_MNT, eMnt0), SERVICE_ALTI),
    acces.binaire(urlAltitudes(COUCHE_MNS, e1), SERVICE_ALTI, true),
    acces.binaire(urlAltitudes(COUCHE_MNS, e2), SERVICE_ALTI, true),
    acces.binaire(urlAltitudes(COUCHE_MNT, eMnt1), SERVICE_ALTI, true),
    acces.image(urlImage(COUCHE_CLASSES, e0, 'image/png'), e0.largeur, e0.hauteur, 'de classification LiDAR HD', true),
    acces.image(urlImage(COUCHE_CLASSES, e1, 'image/png'), e1.largeur, e1.hauteur, 'de classification LiDAR HD', true),
  ]);

  const mns0 = versRaster(await pMns0, e0);
  const manque = partSansDonnee(mns0);

  if (manque > 0.5) {
    // ---------- Repli : pas de LiDAR HD publié ici ----------
    progression('LiDAR HD indisponible ici : repli sur les hauteurs de la BD TOPO…');
    const service = 'd’altimétrie RGE ALTI de l’IGN';
    const [t0, t1, t2, batiProche, batiLarge] = await Promise.all([
      acces.binaire(urlAltitudes(COUCHE_RGE_ALTI, eMnt0), service),
      acces.binaire(urlAltitudes(COUCHE_RGE_ALTI, eMnt1), service),
      acces.binaire(urlAltitudes(COUCHE_RGE_ALTI, { ...e2, pas: 16, largeur: 512, hauteur: 512 }), service),
      pBati,
      chargerBatiments(acces, e0.x0, e0.y1 - 512, e0.x0 + 512, e0.y1),
    ]);
    const sol0 = versRaster(t0, eMnt0);
    boucherTrous(sol0, 0);
    const solFin = reechantillonner(sol0, e0);
    const tous = batiLarge.length ? batiLarge : batiProche;
    const dur = extruderBatiments(solFin, tous);
    const moyen = versRaster(t1, eMnt1);
    const lointain = versRaster(t2, { ...e2, pas: 16, largeur: 512, hauteur: 512 });
    boucherTrous(moyen);
    boucherTrous(lointain);
    const classes = new Uint8Array(dur.d.length);
    for (let i = 0; i < classes.length; i++) classes[i] = dur.d[i] - solFin.d[i] > 1 ? 3 : 1;
    const relief: Relief = { dur, mnt: solFin };
    const aretes = batiProche.flatMap((b, i) => aretesDuBatiment(b, i));
    classerAretes(aretes, relief, etages, batiProche);
    const incertains = tous.filter((b) => !hauteurEstimee(b).fiable).length;
    avertissements.push(
      'Le LiDAR HD de l’IGN n’est pas publié sur cette zone. Le calcul repose sur les emprises et hauteurs de la BD TOPO (bâtiments en blocs à toit plat, sans arbres, dans un rayon de 250 m) et sur le relief du RGE ALTI : résultat indicatif.',
    );
    if (tous.length && incertains / tous.length > 0.2) {
      avertissements.push(`La hauteur de ${Math.round((100 * incertains) / tous.length)} % des bâtiments voisins est inconnue et a été estimée.`);
    }
    return {
      mode: 'bdtopo',
      niveaux: [
        { dur, arbres: null },
        { dur: moyen, arbres: null },
        { dur: lointain, arbres: null },
      ],
      relief,
      mns: dur,
      classes,
      mnsMoyen: moyen,
      classesMoyen: null,
      batiments: batiProche,
      aretes,
      avertissements,
      hauteursIncertaines: tous.length ? incertains / tous.length : 0,
    };
  }

  // ---------- Cas normal : LiDAR HD ----------
  const [rMnt0, rMns1, rMns2, rMnt1, rCl0, rCl1] = await suite;
  if (rMnt0.status === 'rejected') throw rMnt0.reason;
  const mnt0 = versRaster(rMnt0.value, eMnt0);
  if (manque > 0.02) {
    avertissements.push(`Le LiDAR HD ne couvre pas toute la zone (${Math.round(manque * 100)} % sans donnée autour de l’adresse) : les obstacles manquants sont ignorés.`);
  }
  let classes0: Uint8Array | null = null;
  if (rCl0.status === 'fulfilled') classes0 = decoderClasses(rCl0.value, e0.largeur * e0.hauteur);
  else avertissements.push('La carte de classification LiDAR est indisponible : les arbres ne sont pas distingués des bâtiments et comptent comme des obstacles opaques. Relancez la recherche pour réessayer.');
  progression('Séparation des arbres et des bâtiments…');
  const s0 = construireSurfaces(mns0, mnt0, classes0);
  const niveaux: Niveau[] = [{ dur: s0.dur, arbres: classes0 ? s0.arbres : null }];
  const mntFin = reechantillonner(mnt0, e0);
  boucherTrous(mntFin, 0);

  let mnsMoyen: Raster | null = null;
  let classesMoyen: Uint8Array | null = null;
  if (rMns1.status === 'fulfilled') {
    const mns1 = versRaster(rMns1.value, e1);
    mnsMoyen = mns1;
    const mnt1 = rMnt1.status === 'fulfilled' ? versRaster(rMnt1.value, eMnt1) : null;
    const cl1 = rCl1.status === 'fulfilled' && mnt1 ? decoderClasses(rCl1.value, e1.largeur * e1.hauteur) : null;
    if (mnt1) {
      const s1 = construireSurfaces(mns1, mnt1, cl1);
      classesMoyen = s1.classes;
      niveaux.push({ dur: s1.dur, arbres: cl1 ? s1.arbres : null });
    } else {
      const copie = creerRaster(mns1.x0, mns1.y1, mns1.pas, mns1.largeur, mns1.hauteur);
      copie.d.set(mns1.d);
      boucherTrous(copie);
      niveaux.push({ dur: copie, arbres: null });
    }
  } else {
    avertissements.push('Le relief au-delà de 250 m n’a pas pu être téléchargé : les obstacles lointains sont ignorés. Relancez la recherche pour réessayer.');
  }
  if (rMns2.status === 'fulfilled') {
    const mns2 = versRaster(rMns2.value, e2);
    boucherTrous(mns2);
    niveaux.push({ dur: mns2, arbres: null });
  } else if (rMns1.status === 'fulfilled') {
    avertissements.push('Le relief au-delà de 1 km n’a pas pu être téléchargé : les obstacles très lointains sont ignorés. Relancez la recherche pour réessayer.');
  }

  progression('Analyse des façades…');
  const batiments = await pBati;
  const relief: Relief = { dur: s0.dur, mnt: mntFin };
  const aretes = batiments.flatMap((b, i) => aretesDuBatiment(b, i));
  classerAretes(aretes, relief, etages, batiments);
  return {
    mode: 'lidar',
    niveaux,
    relief,
    mns: mns0,
    classes: s0.classes,
    mnsMoyen,
    classesMoyen,
    batiments,
    aretes,
    avertissements,
    hauteursIncertaines: 0,
  };
}
