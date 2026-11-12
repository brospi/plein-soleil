/** Section « Méthode et limites » : ce que l'outil calcule, et ce qu'il ne sait pas. */
export const METHODE_HTML = `
<p class="aide">Plein Soleil répond à une question précise : <strong>quand le soleil atteint-il directement cette fenêtre, par ciel clair ?</strong> Voici comment, et ce que le résultat ne dit pas.</p>

<details>
  <summary>Ce qui est calculé</summary>
  <ul>
    <li><strong>Position du soleil</strong> toutes les 2 minutes sur une année type (2026), par l’algorithme de la NOAA (d’après Meeus), réfraction atmosphérique incluse, en heure légale française avec changement d’heure. Écart inférieur à 0,05° par rapport à l’algorithme de référence SPA du NREL.</li>
    <li><strong>Masque d’horizon</strong> vu depuis la fenêtre : lancer de rayons tous les 0,25° d’azimut sur le modèle de surface LiDAR HD de l’IGN, au pas de 50 cm jusqu’à 250 m, 2 m jusqu’à 1 km, puis 8 m jusqu’à 4 km (collines lointaines). Courbure de la Terre prise en compte.</li>
    <li><strong>La fenêtre est une surface</strong> : le vitrage est découpé en plusieurs points ; l’embrasure (tableaux et linteau) et un éventuel balcon au-dessus projettent leur ombre. D’où la « part du vitrage au soleil » à chaque instant.</li>
    <li><strong>Arbres</strong> : la carte de classification LiDAR de l’IGN sépare la végétation des bâtiments. Selon le mode choisi, les arbres sont ignorés, opaques d’avril à octobre (feuillus) ou opaques toute l’année (persistants).</li>
    <li><strong>Énergie</strong> : rayonnement direct par ciel clair du modèle ESRA (Rigollier et al., 2000), trouble de Linke de 3, projeté sur le plan vertical de la fenêtre et multiplié par la part éclairée.</li>
    <li><strong>Ciel visible</strong> : facteur de vue du ciel du vitrage, rapporté à celui d’une façade dégagée. C’est un indicateur de lumière diffuse, utile pour les façades au nord et les cours.</li>
  </ul>
</details>

<details>
  <summary>Comment lire les indicateurs</summary>
  <ul>
    <li><strong>Heures de soleil</strong> : durée pendant laquelle une partie au moins du vitrage (plus de 2 %) reçoit le soleil direct.</li>
    <li><strong>Plein soleil</strong> : aucun obstacle extérieur (bâtiment, arbre, balcon) ne masque le vitrage ; seule l’embrasure, inévitable, en ombre éventuellement une partie.</li>
    <li><strong>Part du maximum</strong> : rapport aux heures qu’aurait la même fenêtre, même orientation, sur une façade sans aucun vis-à-vis. Une façade nord dégagée affiche 100 % avec seulement 800 h par an.</li>
    <li><strong>Jours sans soleil</strong> : jours de l’année type où le soleil n’atteint jamais le vitrage.</li>
  </ul>
</details>

<details>
  <summary>Limites à garder en tête</summary>
  <ul>
    <li><strong>Pas de météo.</strong> Les heures affichées sont un potentiel par ciel clair. À Paris, le soleil brille réellement environ 1 700 h par an sur les 4 470 h de jour : comptez de l’ordre de 35 à 40 % du potentiel en moyenne, davantage en été qu’en hiver. L’outil sert à <em>comparer</em> des logements, pas à prédire un relevé.</li>
    <li><strong>Le LiDAR date du survol</strong> (entre 2020 et 2025 selon les zones). Une construction, une surélévation ou un abattage postérieurs n’y figurent pas.</li>
    <li><strong>Résolution de 50 cm.</strong> Garde-corps ajourés, antennes, stores et volets sont ignorés ; un obstacle très proche (moins de 3 m) est positionné à une cellule près, ce qui peut déplacer une ombre de quelques minutes.</li>
    <li><strong>Arbres simplifiés.</strong> Un arbre est un volume plein du sol au sommet du houppier : la lumière passant sous les branches n’est pas comptée. La transmission d’hiver est un réglage moyen, pas une mesure.</li>
    <li><strong>Position de la fenêtre.</strong> L’emprise cadastrale et le LiDAR sont décalés de 1 à 2 m ; le mur réel est recherché sur le relief à chaque étage, et le point d’observation placé 50 cm devant. Les étages sont espacés régulièrement : quand la BD TOPO donne le nombre de niveaux de l’immeuble et qu’il est plausible (2,4 à 4,2 m par niveau), la hauteur d’étage est la hauteur de l’immeuble divisée par ce nombre ; sinon elle vaut 3 m par défaut. La hauteur de l’immeuble est soit celle du LiDAR (toit compris), soit celle de la BD TOPO (à la gouttière) : faute de savoir si les combles sont comptés dans les niveaux, on retient celle qui donne l’étage le plus proche de 3 m. Le rez-de-chaussée est supposé de la même hauteur que les autres niveaux. Ajustez la hauteur d’étage, ou cliquez la fenêtre en 3D pour une hauteur exacte.</li>
    <li><strong>Lumière diffuse et réfléchie</strong> (ciel, façades claires en vis-à-vis) : non calculée, hormis l’indicateur de ciel visible.</li>
    <li><strong>Zones sans LiDAR HD</strong> : l’outil le signale et se replie sur les hauteurs de la BD TOPO (blocs à toit plat, sans arbres). Le résultat n’est alors qu’indicatif.</li>
    <li><strong>Cours et courettes</strong> : un résultat de 0 h peut être parfaitement exact. L’outil l’explique quand la part de ciel visible est très faible.</li>
  </ul>
</details>

<details>
  <summary>Données et confidentialité</summary>
  <ul>
    <li>Relief <code>LiDAR HD</code> (MNS, MNT, carte de classes), bâtiments <code>BD TOPO</code>, adresses et fonds de carte : services ouverts de la Géoplateforme de l’IGN, interrogés directement par votre navigateur.</li>
    <li>Si le service d’adresses de l’IGN est en panne, la recherche bascule sur Photon (données OpenStreetMap).</li>
    <li>Aucun serveur propre à Plein Soleil : rien n’est envoyé ailleurs, les logements comparés restent dans le stockage local de votre navigateur, et les tuiles déjà téléchargées sont gardées 30 jours en cache.</li>
  </ul>
</details>
`;
