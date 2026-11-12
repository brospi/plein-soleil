# Plein Soleil

**L'ensoleillement direct d'une fenêtre d'appartement, étage par étage et jour par jour.**

Plein Soleil calcule, pour une année type et par ciel clair, les heures où le soleil atteint directement une fenêtre : immeubles voisins, relief et arbres compris, à partir du relevé LiDAR HD de l'IGN (50 cm). L'outil sert à comparer des logements pendant une recherche d'achat.

- Gratuit, en français, sans compte ni serveur : tout le calcul se fait dans le navigateur.
- Site statique, prêt pour GitHub Pages.

**Démo : <https://brospi.github.io/plein-soleil/>**

## Utilisation

1. Saisir l'adresse.
2. Toucher le mur où se trouve la fenêtre, sur la carte ou dans la vue 3D (hauteur exacte).
3. Choisir l'étage : indicateurs, graphiques et comparaison par étage s'affichent aussitôt.

On peut ajouter d'autres façades du même logement (traversant, angle), enregistrer jusqu'à 4 logements dans le comparateur, partager un lien qui rouvre exactement le calcul, exporter une fiche PDF et un CSV jour par jour.

## Développement

```bash
npm install
npm run dev        # serveur de développement
npm run build      # vérification des types + site statique dans dist/
npm run lint
npm test           # tests unitaires (Vitest)
npm run test:e2e   # tests de bout en bout (Playwright, services IGN réels)
```

Les tests de bout en bout demandent une première fois `npx playwright install chromium`. Pour les lancer contre un site déjà déployé : `BASE_URL=https://brospi.github.io/plein-soleil/ npm run test:e2e`. Les tests d'intégration du moteur sur données réelles, hors navigateur, se lancent avec `RESEAU=1 npx vitest run tests/reel.test.ts`.

## Architecture

```
src/
  coeur/      calcul pur, sans navigateur (testé unitairement)
    soleil.ts          position du soleil (NOAA), heure légale, table annuelle
    lambert93.ts       projection Lambert 93, convergence des méridiens
    horizon.ts         lancer de rayons multi-résolution, enveloppes d'horizon
    facades.ts         arêtes, normales, murs mitoyens, position réelle du mur
    fenetre.ts         embrasure, balcon, échantillonnage du vitrage
    simulation.ts      simulation annuelle, indicateurs, ciel visible
    cielclair.ts       rayonnement direct par ciel clair (ESRA)
    classification.ts  séparation arbres / bâti depuis la carte de classes LiDAR
    maillage.ts        maillage 3D à murs verticaux
    calcul.ts          orchestration d'une fenêtre, tous étages
  donnees/    services IGN, géocodage, relances réseau, cache IndexedDB, PNG
  moteur/     Web Worker : chargement de scène et calculs
  ui/         interface (TypeScript sans framework), graphiques canvas, 3D (three.js)
tests/        tests unitaires et d'intégration
e2e/          tests de bout en bout
```

### Idées clés

- **La zone chargée suit la carte.** Bâtiments et relief fin ne sont téléchargés que dans un rayon de 160 m. Quand la carte s'en éloigne de plus de 70 m, la zone est rechargée à l'endroit affiché ; si une fenêtre est déjà placée, un bouton le propose au lieu de le faire d'office.
- **Relief en trois niveaux**, une requête WMS par niveau, calée sur une grille pour que le cache serve : 0,5 m sur 512 m de côté, 2 m sur 2 km, 8 m sur 8 km.
- **Enveloppes d'horizon.** Pour chaque azimut (pas de 0,25°), le rayon traverse les cellules du raster par un parcours de grille exact. On ne garde que l'enveloppe convexe supérieure du profil (distance, altitude) : elle suffit pour retrouver l'angle d'horizon depuis n'importe quelle hauteur sur la même verticale. Changer d'étage ne relance donc aucun rayon (10 à 40 ms mesurés).
- **Deux horizons**, bâti et arbres, grâce à la carte de classes LiDAR HD (`IGNF_LIDAR-HD_CLASS`).
- **La fenêtre est une surface** : 2 à 6 points en largeur et en hauteur ; l'embrasure et le balcon sont traités analytiquement, les obstacles lointains par échantillonnage.
- **Position du mur relue sur le LiDAR** à chaque étage le long de la normale (décalage cadastre / LiDAR de 1 à 2 m, étages en retrait), point d'observation 50 cm devant.
- **Hauteur d'étage calée par immeuble.** Quand la BD TOPO donne le nombre de niveaux du bâtiment (environ 80 % des cas à Paris), la hauteur d'étage est la hauteur de l'immeuble divisée par ce nombre, si le résultat est plausible (2,4 à 4,2 m). Entre la hauteur LiDAR (toit compris) et la hauteur BD TOPO (à la gouttière), on retient celle qui donne l'étage le plus proche de la valeur par défaut. Sinon : 3 m par étage. Le réglage est désactivable et une saisie manuelle l'emporte.
- **Azimuts « grille »** : le soleil est ramené dans le repère Lambert 93 par la convergence des méridiens (−0,5° à Paris, +3,4° à Strasbourg).

## Données (appelées directement par le navigateur)

Tous ces services ont été vérifiés avec un en-tête `Origin` étranger (`Access-Control-Allow-Origin: *`).

| Donnée | Service | Remarques |
|---|---|---|
| MNS et MNT LiDAR HD | WMS-Raster `data.geopf.fr/wms-r/wms`, couches `IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93` et `..._MNT_...` | `image/x-bil;bits=32`, EPSG:2154, sans donnée = −9999. Renvoie parfois un 400 passager sur une requête valide, avec un cache de 21 jours : les relances contournent le cache du navigateur |
| Classes LiDAR HD | même WMS, couche `IGNF_LIDAR-HD_CLASS`, PNG | palette fixe (sol, végétation, bâtiment, eau, pont…), alignée sur le MNS |
| Terrain de repli | même WMS, `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` (RGE ALTI) | zones sans LiDAR HD |
| Bâtiments | WFS `data.geopf.fr/wfs/ows`, `BDTOPO_V3:batiment` | renvoie parfois une page non JSON avec un code 200 : relancé |
| Adresses | `data.geopf.fr/geocodage/search`, repli Photon (`photon.komoot.io`) | Photon est lancé en parallèle si l'IGN n'a pas répondu en 1,2 s ; si le numéro demandé est absent de la Base Adresse Nationale, le numéro existant le plus proche (±10) est cherché et proposé en tête ; à défaut, la rue entière est signalée |
| Fonds de carte | WMTS `data.geopf.fr/wmts` (Plan IGN v2, orthophotos) | |
| Photo aérienne 3D | WMS `HR.ORTHOIMAGERY.ORTHOPHOTOS` | texture optionnelle de la vue 3D |

Non retenu : les nuages de points LiDAR HD classés (COPC). La carte de classes raster répond au besoin pour un coût bien moindre ; l'index des dalles n'a pas été trouvé dans le WFS lors de l'investigation, et l'accès CORS aux fichiers n'a donc pas été testé.

## Validation

Tests unitaires (`npm test`) :

- **Soleil** : 13 instants comparés à l'algorithme SPA du NREL (via pvlib), écart < 0,05° ; exemple de la publication SPA ; levers et couchers à Paris aux solstices ; changement d'heure.
- **Lambert 93** : 8 points comparés à PROJ, écart < 5 mm ; convergence des méridiens.
- **Lancer de rayons** : mur de hauteur et distance connues ; comparaison à une intersection exhaustive rayon-cellule sur un relief aléatoire ; passage entre niveaux de résolution.
- **Étages** : calage sur le nombre de niveaux connu, rejet des nombres incohérents, choix entre toit LiDAR et gouttière, liens de partage anciens inchangés.
- **Façades** : normale sortante quel que soit le sens de l'anneau, cours intérieures, murs mitoyens, voisin plus bas, décalage cadastre / LiDAR de 1,5 m, étage en retrait.
- **Ordres de grandeur** (Paris, immeuble isolé) : façade sud ≈ 3 600 h/an, nord ≈ 800 h/an, sud + nord = durée du jour, est ≈ ouest ; l'ensoleillement croît avec l'étage dans une rue de 10 m ; recalcul d'un étage < 100 ms.
- **Arbres, classification, maillage, exports, état partagé par URL.**

Tests de bout en bout (`npm run test:e2e`) sur les services réels : Paris 11e, Montreuil, Lyon 1er (parcours complet, cohérence des résultats, performances), Lille (repli sans LiDAR HD), partage par lien, comparateur, exports PDF et CSV, vue 3D, affichage mobile, rechargement de la zone quand la carte se déplace, erreurs passagères de l'IGN (400 mis en cache, 429).

## Limites connues

Voir la section « Méthode et limites » de l'application. En bref : pas de météo (potentiel par ciel clair), LiDAR daté du survol, résolution de 50 cm, arbres pleins du sol au sommet, lumière diffuse non calculée hormis la part de ciel visible, repli indicatif sans LiDAR HD.

## Déploiement

Le site est statique (`dist/`) et utilise des chemins relatifs : il fonctionne sous n'importe quel sous-chemin.

- **Branche `gh-pages`** (méthode utilisée pour la démo) : `npm run publier` construit le site et pousse `dist/` sur la branche `gh-pages`. Dans le dépôt : _Settings → Pages → Source : Deploy from a branch → gh-pages_.
- **GitHub Actions** (facultatif) : copier `deploiement/github-actions-pages.yml` dans `.github/workflows/` pour lancer lint, types, tests et construction, puis publier à chaque poussée sur `main` (_Settings → Pages → Source : GitHub Actions_). Pousser ce fichier demande un jeton avec le droit `workflow`.

L'application doit être servie en HTTPS sur un vrai domaine (Web Worker, IndexedDB, presse-papiers) ; elle n'est pas prévue pour un iframe « sandboxé ».

## Attributions

- Relief, bâtiments, adresses, fonds de carte : © IGN — Géoplateforme (LiDAR HD, BD TOPO®, Plan IGN, BD ORTHO®), licence Ouverte Etalab 2.0.
- Recherche d'adresse de secours : Photon (komoot), données © les contributeurs d'OpenStreetMap (ODbL).
- Bibliothèques : Leaflet, three.js, jsPDF, police Inter.

## Licence

MIT.
