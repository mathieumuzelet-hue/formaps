# Passation : Portail Cockpit — Bascule Auchan → Intermarché

## Vue d'ensemble
**Cockpit** est un portail web interne permettant à l'ensemble des salariés de se connecter
pour suivre la **bascule Auchan → Intermarché** de leur magasin. Il regroupe :
- un **Accueil / tableau de bord** (point du jour sur la bascule, parcours par étapes, accès rapides) ;
- un **Espace Formation** (Mercalys, Encaissement, Comptabilité…) — dans un 1er temps les fiches
  renvoient vers **SharePoint**, puis vers des **pages dédiées de téléchargement PDF** (phase 2) ;
- un **Espace BRAIN** — un **chat IA RAG** qui répond aux questions à partir des documents internes,
  avec **citation des sources** et **questions suggérées**.

La direction visuelle retenue est **B · « Le Trajet »** : éditorial et chaleureux, papier chaud,
gros titres serif, la bascule racontée comme un parcours par étapes. Marque société : **A⁺SUPER (APS)**.

> ℹ️ Deux autres directions (A · Tableau de bord, C · Poste de pilotage) ont été explorées puis écartées.
> Elles restent consultables dans `Cockpit — Directions.html` à la racine du projet (hors de ce bundle).

## À propos des fichiers de design
Les fichiers de ce bundle sont des **références de design réalisées en HTML/React (via Babel in-browser)** :
ce sont des **prototypes** qui montrent l'aspect et le comportement visés, **pas du code de production à copier tel quel**.

La tâche consiste à **recréer ces écrans dans l'environnement cible** (le futur codebase : React, Next.js,
Vue, etc.) en suivant ses conventions et sa bibliothèque de composants. S'il n'existe pas encore
d'environnement, choisir le framework le plus adapté (React/Next.js recommandé vu la structure actuelle)
et y implémenter les écrans.

Le code de référence est volontairement découpé proprement pour faciliter la reprise :
- `directions/shared.jsx` — icônes (SVG inline), données (formations, conversation BRAIN, détail formation), placeholders, logo.
- `directions/dirB.jsx` — tous les écrans de la Direction B + sous-composants (`BNav`, `BRoute`).
- `Cockpit — Prototype (Direction B).html` — assemble le tout en prototype cliquable (router + mise à l'échelle).

## Fidélité
**Haute fidélité (hifi).** Couleurs, typographie, espacements et interactions sont définitifs.
Recréer l'UI au pixel près avec les composants/patterns du codebase cible. Les seules zones « placeholder »
sont les **visuels de couverture** (rayures + libellé monospace) qui attendent de vraies images,
et le **contenu BRAIN** qui est un exemple illustratif.

---

## Écrans

### 1. Connexion (`LoginB`)
- **But** : authentifier le salarié (identifiant salarié + mot de passe).
- **Layout** : deux colonnes. Gauche **54%** = panneau de marque (fond `#FBF7EF`, bordure droite `1px #E4DBCB`,
  padding `54px 56px`) : logo Cockpit en haut, puis bloc poussé en bas (`margin-top:auto`) avec sur-titre
  rouge « AUCHAN → INTERMARCHÉ », titre serif `Newsreader 46px/1.08`, paragraphe `15.5px/1.6`, et la
  **timeline de parcours** (`BRoute`) en pied. Droite = formulaire centré (largeur **350px**) sur fond `#F4EEE3` :
  logo APS aligné à droite, titre serif `30px` « Se connecter », 2 champs, lien « Mot de passe oublié ? »,
  bouton plein rouge « Embarquer → ».
- **Champs** : libellé `12.5px/700 #8A7F6E`, conteneur `border 1px #E4DBCB`, `border-radius 10px`,
  `padding 13px 14px`, fond `#FFFFFF`, icône `user` / `lock` à gauche (`#B7AD9A`).
- **Bouton** : fond `#C8102E`, texte blanc `15.5px/700`, `border-radius 10px`, `padding 15px`, icône flèche.
  → **Action** : navigue vers l'Accueil.

### 2. Accueil / Tableau de bord (`HomeB`)
- **But** : donner le point du jour sur la bascule et l'accès rapide aux espaces.
- **Layout** : `BNav` (barre de nav haute) + contenu `padding 30px 40px`, colonne `gap 22px`.
  1. **En-tête** : ligne flex. Gauche : sur-titre rouge « VOTRE TRAJET · MAGASIN DE LILLE » + titre serif
     `38px` « Bonjour Camille, plus que **18 jours** » (le nombre en rouge). Droite (`margin-left:auto`) :
     « Étape en cours » + « 2 · Formation des équipes ».
  2. **Carte parcours** : fond `#FBF7EF`, bordure `1px #E4DBCB`, `border-radius 18px`, `padding 26px 40px 24px`,
     contient `BRoute` (5 étapes, étape courante = index 1).
  3. **2 cartes d'accès** (grid `1fr 1fr`, `gap 18px`) : « Espace Formation » (fond blanc) et « Assistant BRAIN »
     (fond sombre `#221C16`, texte blanc). Chaque carte : pastille ronde `50px` avec icône, titre serif `23px`,
     description, lien CTA. → cliquables vers `form` / `brain`.
  4. **Bande « À reprendre »** : titre serif `19px` + lien « Tout l'espace formation → » ; grid de 3 cartes
     formation compactes avec barre de progression (largeurs 70% / 30% / 100%). → cliquables vers le détail.

### 3. Espace Formation (`FormB`)
- **But** : parcourir les formations par thème.
- **Layout** : `BNav` + contenu `padding 28px 40px`. En-tête : titre serif `34px` « Espace Formation »
  + paragraphe explicatif (mention SharePoint → PDF). **Grille de 8 cartes** : `grid-template-columns: repeat(4,1fr)`, `gap 16px`.
- **Carte formation** : fond `#FFFFFF`, bordure `1px #E4DBCB`, `border-radius 14px`, `padding 18px`,
  colonne `gap 12px`. Numéro d'index en serif `26px #E4DBCB` en haut à droite. Pastille ronde `46px`
  fond `#F4E5E1` avec icône thème (`#A20D24`). Nom en serif `18px`, description `12.5px #8A7F6E`.
  Pied (bordure haute) : lien `Télécharger le PDF` (icône download, `#A20D24`) si `kind: 'pdf'`,
  sinon `Ouvrir dans SharePoint` (icône external, `#8A7F6E`). → carte cliquable vers le détail.

### 4. Détail d'une formation (`FormDetailB`) — page PDF dédiée (phase 2)
- **But** : télécharger directement les PDF d'une formation (exemple : **Encaissement**).
- **Layout** : `BNav` + contenu en **2 colonnes** (`grid 1.7fr 1fr`, `gap 34px`).
  - **Gauche** : fil d'Ariane cliquable (← Espace Formation / Encaissement), sur-titre tag `CAISSE`,
    titre serif `40px`, chapô serif `17.5px/1.55 #8A7F6E`, ligne de méta (`N documents`, durée, date MAJ)
    sous une bordure. Puis **liste de documents** : chaque ligne = numéro serif `24px`, titre serif `17px`,
    badge « NOUVEAU » optionnel (`border 1px #C8102E`, rouge), méta `PDF · N pages · taille`, lien
    « Télécharger » (icône + `#A20D24`), séparées par `border-bottom 1px #E4DBCB`.
  - **Droite** : placeholder visuel de couverture (`170px`) ; carte **Progression** (`%` en serif `32px`
    + barre + lien SharePoint) ; carte **« Pour aller plus loin »** (formations liées).

### 5. Espace BRAIN — chat IA RAG (`BrainB`)
- **But** : poser des questions ; l'IA répond à partir des documents internes, **sources citées**.
- **Layout** : `BNav` + conteneur centré `max-width 860px`, `padding 26px 40px 0`.
  En-tête : pastille ronde rouge `46px` (icône `brain`), titre serif `26px` « BRAIN » + sous-titre.
  - **Message utilisateur** : aligné à droite, fond sombre `#221C16`, texte blanc, bulle
    `border-radius 18px 18px 5px 18px`, `padding 13px 18px`.
  - **Réponse IA** : alignée à gauche, **texte en serif `16.5px/1.7`** suivi d'appels de note `[1][2]` en rouge ;
    puis bloc **« SOURCES CITÉES »** (bordure haute) listant chaque source numérotée (pastille ronde
    `border 1.5px #C8102E`), icône fichier, nom du document, tag, page, icône external à droite.
  - **Bas** : libellé « SUGGESTIONS » + chips de questions suggérées (`border 1px #E4DBCB`, `border-radius 20px`),
    puis champ de saisie (`border 1px`, `border-radius 14px`) avec bouton d'envoi rouge `44px`.

### Mobile (`HomeBMobile`, 390×844)
Accueil responsive : barre de marque en haut, titre serif réduit, carte parcours (`BRoute compact`),
2 cartes d'accès empilées, **barre d'onglets fixe en bas** (Accueil / Former / BRAIN / Profil).
Tous les écrans sont pensés responsive (desktop + mobile).

---

## Composant transverse — `BRoute` (timeline de parcours)
Représente les 5 étapes de la bascule : **Préparation · Formation · Tests · Bascule · Ouverture**.
- Ligne de fond grise (`#E4DBCB`) + ligne de progression rouge dont la largeur = `current/(N-1)`.
- Chaque étape : pastille ronde. Terminée = pleine rouge + coche ; courante = `28px` pleine rouge + point blanc ;
  à venir = `22px` fond clair + numéro `#B7AD9A`. Libellé `12.5px` (gras si courante).
- Prop `current` (index 0-based, **1** = Formation dans les maquettes), prop `compact` (masque les libellés, pour mobile).

## Interactions & comportement
- **Navigation** (prototype) : un état `route` ∈ `{login, home, form, detail, brain}`. La barre `BNav`,
  le bouton « Embarquer », les cartes d'accès et les cartes formation déclenchent `navTo(id)`.
  Dans le codebase cible, remplacer par le routeur natif (ex. Next.js App Router : `/`, `/accueil`,
  `/formations`, `/formations/[id]`, `/brain`, `/connexion`).
- **Transition d'écran** : léger fondu + translation `translateY(6px) → 0` sur `0.26s ease` (clé = route).
- **Mise à l'échelle** (prototype uniquement) : le stage `1280×860` est mis à l'échelle
  `min(vw/1280, vh/860)` et centré/letterboxé. **À ne PAS reproduire** en production — le vrai site est responsive fluide.
- **États à prévoir côté dev** (non maquettés) : focus/hover des champs et boutons, chargement (réponse BRAIN
  en streaming), erreurs (login invalide, document indisponible), validation de formulaire, état vide
  (aucune formation / aucun message).

## Espace BRAIN — notes d'implémentation RAG
- Le front envoie la question → backend RAG (récupération de passages dans les documents internes + génération).
- La réponse doit renvoyer **le texte** + **une liste de sources** : `{ doc, page, tag }`. Les appels de note
  `[n]` dans le texte référencent l'index dans cette liste.
- Prévoir : questions suggérées (configurables), historique de conversation, garde-fou affiché
  (« BRAIN peut faire des erreurs, vérifiez via les sources »).

## State management (suggestions)
- `auth` : utilisateur connecté (identifiant, magasin, rôle).
- `bascule` : magasin, étape courante (0–4), J-N, % de parcours.
- `formations` : liste (id, nom, thème/tag, icône, type `sharepoint|pdf`, nb docs, progression).
- `formationDetail` : docs `{ titre, pages, taille, nouveau }`, progression, liés.
- `brain` : messages `{ role, text, sources[] }`, suggestions, état de chargement.

---

## Design tokens (Direction B)

### Couleurs
| Token | Hex | Usage |
|---|---|---|
| `bg` | `#F4EEE3` | Fond général (papier chaud) |
| `surface` | `#FBF7EF` | Panneaux / barres / cartes secondaires |
| `card` | `#FFFFFF` | Cartes principales, champs |
| `ink` | `#221C16` | Texte principal ; cartes sombres (BRAIN, carte « Assistant ») |
| `sub` | `#8A7F6E` | Texte secondaire |
| `faint` | `#B7AD9A` | Texte tertiaire, numéros, icônes discrètes |
| `line` | `#E4DBCB` | Bordures, séparateurs |
| `red` | `#C8102E` | Accent principal (rouge Intermarché), boutons, progression |
| `redSoft` | `#F4E5E1` | Fond de pastilles d'icônes |
| `redInk` | `#A20D24` | Rouge texte sur fond clair (liens, CTA) |
| `sand` | `#EADFC9` | Avatar / fonds neutres chauds |

> Le **logo A⁺SUPER** est rouge ~`#FA1E32` ; le rouge d'interface retenu est `#C8102E` (plus profond, meilleur contraste texte).

### Typographie
- **Titres / éditorial** : **Newsreader** (serif), poids 400–600. Tailles repères : 46 (login), 40 (détail),
  38 (accueil), 34 (formation), 26–30 (BRAIN/login secondaire), 17–24 (sous-titres/cartes).
- **Interface / corps** : **Hanken Grotesk** (sans), poids 400–800. Corps 14–15.5px, méta 11–13px,
  labels 700, sur-titres `letter-spacing .04–.05em` en majuscules.
- Polices chargées via Google Fonts (cf. `<link>` dans le HTML).

### Rayons, ombres, espacements
- **border-radius** : pastilles `50%` ; champs/boutons `10px` ; cartes `14px` ; grandes cartes `16–18px`.
- **bordures** : `1px solid #E4DBCB` (standard).
- **ombre** (prototype, conteneur) : `0 30px 90px rgba(40,30,20,.22)`.
- **espacements** récurrents : gouttières `14 / 16 / 18 / 22px` ; paddings écran `26–30px vertical, 40px horizontal` ;
  paddings cartes `16–26px`.

## Assets
- `assets/logo-aps.png` — logo **A⁺SUPER** détouré (fond transparent, ~467×147), fourni par le client.
  Utilisé en haut à droite des en-têtes et sur l'écran de connexion. Existe aussi en rouge sur n'importe quelle surface claire.
- **Icônes** : jeu de SVG stroke inline (`Icon` dans `shared.jsx`, viewBox 24, `stroke-width ~1.7`).
  À remplacer côté codebase par sa propre librairie d'icônes (Lucide/Feather sont visuellement proches).
- **Visuels de couverture** : placeholders rayés à remplacer par de vraies photos (caisse, magasin, captures d'écran).

## Fichiers de ce bundle
- `Cockpit — Prototype (Direction B).html` — prototype cliquable (point d'entrée).
- `directions/dirB.jsx` — écrans Direction B + `BNav`, `BRoute`, sous-composants.
- `directions/shared.jsx` — `Icon`, `ApsLogoSlot`, `ImgSlot`, données (`TRAININGS`, `BRAIN_*`, `FORMATION_DETAIL`).
- `assets/logo-aps.png` — logo A⁺SUPER (transparent).
- Pour ouvrir le prototype : servir le dossier en HTTP (les `.jsx` sont chargés via `<script src>`).
