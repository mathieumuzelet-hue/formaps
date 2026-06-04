# Cockpit — Portail Bascule Auchan → Intermarché (A⁺SUPER) — Design

**Date :** 2026-06-04
**Repo :** github.com/mathieumuzelet-hue/formaps
**Déploiement cible :** VPS Dokploy + Traefik
**Direction visuelle :** B · « Le Trajet » (handoff Claude Design, fidélité hifi)

---

## 1. Objectif

Portail web interne permettant à tous les salariés A⁺SUPER (APS) de suivre la bascule
Auchan → Intermarché de leur magasin. Trois piliers :

1. **Accueil / tableau de bord** — point du jour sur la bascule (J-N calculé, parcours par
   étapes, accès rapides).
2. **Espace Formation** — catalogue de formations (Mercalys, Encaissement, Comptabilité…).
   Phase 1 : fiches → SharePoint. Phase 2 : pages dédiées de téléchargement PDF.
3. **Espace BRAIN** — chat IA RAG branché sur **Dify** (API), réponses avec **citation des
   sources** et questions suggérées.

Périmètre V1 : portail fullstack avec **données réelles** (auth, magasins, formations,
progression) + **zone admin** + BRAIN via Dify. **L'admin fait partie de la V1.**

---

## 2. Stack & architecture

Monolithe **Next.js 16 (App Router)** :

- **tRPC** — API typée bout-en-bout (progression, admin, formations).
- **Drizzle ORM + PostgreSQL** — persistance.
- **Auth.js v5** (credentials email + mot de passe, hash) — sessions JWT, rôles.
- **Tailwind CSS 4** + tokens de la Direction B.
- **Dify** (autre container du même VPS) appelé via une **route serveur** `/api/brain` qui
  proxifie le streaming SSE (la clé API Dify ne touche jamais le navigateur).

Un seul container Next.js standalone + Postgres, déployés sur Dokploy derrière Traefik.

### Raisons
Colle à la stack maîtrisée (OpenRAG, Vetilio) : un seul déploiement, typage complet, et
tout le sous-système RAG lourd (ingestion docs, vector store, LLM) est externalisé à Dify.

---

## 3. Routes (App Router)

| Route | Écran | Accès |
|---|---|---|
| `/connexion` | Login (LoginB) | public |
| `/` | Accueil (HomeB) | connecté |
| `/formations` | Espace Formation (FormB) | connecté |
| `/formations/[slug]` | Détail formation (FormDetailB) | connecté |
| `/brain` | BRAIN chat (BrainB) | connecté |
| `/admin/magasins` | Admin magasins | rôle `admin` |
| `/admin/formations` | Admin catalogue formations | rôle `admin` |
| `/admin/utilisateurs` | Admin comptes | rôle `admin` |
| `/api/brain` | Proxy streaming Dify | connecté |
| `/api/trpc/[trpc]` | tRPC | connecté |
| `/api/auth/[...nextauth]` | Auth.js | public |

- **Middleware** : protège tout sauf `/connexion` (+ assets/auth). Redirige les non-connectés
  vers `/connexion`, les non-admin hors de `/admin/*`.
- **Transition d'écran** : léger fondu + `translateY(6px) → 0` sur `0.26s ease`, clé = route.
- **Pas** de mise à l'échelle façon prototype : site responsive fluide (desktop + mobile).

---

## 4. Modèle de données (Drizzle / Postgres)

### `stores`
| Champ | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | ex. « Magasin de Lille » |
| `basculeDate` | date | **date J fournie par l'admin** |
| `currentStep` | int (0–4) | étape courante du parcours |
| `createdAt` / `updatedAt` | timestamp | |

`joursRestants` (J-N) et `progressPercent` du parcours sont **calculés** côté serveur
(`basculeDate − today`, `currentStep / 4`), jamais stockés en dur.

### `users`
| Champ | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `email` | text unique | identifiant de connexion |
| `passwordHash` | text | argon2id (ou bcrypt) |
| `firstName` | text | « Camille » |
| `role` | enum `employee` \| `admin` | |
| `storeId` | uuid FK → stores | **un utilisateur = un magasin** |
| `createdAt` / `updatedAt` | timestamp | |

### `formations`
| Champ | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text unique | utilisé dans l'URL |
| `name` | text | « Encaissement » |
| `tag` | text | « Caisse » |
| `icon` | text | nom d'icône Lucide |
| `description` | text | |
| `kind` | enum `sharepoint` \| `pdf` | détermine le CTA de la carte |
| `sharepointUrl` | text null | si `kind=sharepoint` |
| `docCount` | int | |
| `order` | int | tri d'affichage |

### `formation_documents` (phase 2 — pages PDF dédiées)
| Champ | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `formationId` | uuid FK → formations | |
| `title` | text | |
| `pages` | int | |
| `sizeLabel` | text | « 2,4 Mo » |
| `fileUrl` | text | PDF |
| `isNew` | bool | badge « NOUVEAU » |
| `order` | int | |

### `user_formation_progress`
| Champ | Type | Note |
|---|---|---|
| `userId` | uuid FK → users | |
| `formationId` | uuid FK → formations | |
| `status` | enum `not_started` \| `in_progress` \| `done` | |
| `progressPercent` | int (0–100) | barres de progression |
| `updatedAt` | timestamp | |

Unicité `(userId, formationId)`. Alimente « 3/8 terminées » et les barres de l'accueil/détail.

### BRAIN
- `users.difyConversationId` (text null) — l'historique vit côté Dify (réutilisé via
  `conversation_id`). Pas de table messages en V1.
- Questions suggérées : config statique en V1 (constante), évolutif vers table plus tard.

---

## 5. BRAIN ↔ Dify

Flux d'une question :

1. Le client poste la question à `/api/brain` (route serveur).
2. Le serveur appelle `POST {DIFY_API_URL}/v1/chat-messages` :
   - `response_mode: "streaming"`
   - `user`: id utilisateur
   - `conversation_id`: `users.difyConversationId` (créé au 1er échange, persisté ensuite)
   - `inputs: {}`, `query`: la question
   - header `Authorization: Bearer {DIFY_API_KEY}`
3. Le serveur relaie le **SSE** vers le client. On parse :
   - events `message` → fragments de texte de la réponse (rendu dans la bulle serif `16.5px`).
   - event `message_end` → `metadata.retriever_resources[]` → mappés en sources
     `{ doc: document_name, page: position/segment, tag }` pour le bloc **SOURCES CITÉES**.
4. Garde-fou affiché en permanence : « BRAIN peut faire des erreurs, vérifiez via les sources ».

**Nuance citations `[n]`** : les appels de note inline `[1][2]` dépendent de ce que renvoie
le modèle Dify. Décision V1 : on numérote la liste `retriever_resources` (1..n, pastilles
rondes rouges) ; si le texte contient déjà des marqueurs `[n]` on les met en exposant rouge,
sinon on ancre les marqueurs en fin de réponse. À affiner à l'implémentation.

**États** : chargement (streaming en cours, curseur/typing), erreur (Dify indisponible →
message + retry), vide (aucun message → suggestions seules).

Config : `DIFY_API_URL`, `DIFY_API_KEY` (env). Dify joint via réseau interne du VPS.

---

## 6. Authentification

- **Auth.js v5**, provider **credentials** (email + mot de passe).
- Mot de passe hashé (argon2id préféré, bcrypt acceptable).
- Session **JWT** ; le token porte `userId`, `role`, `storeId`.
- **Guards** :
  - middleware : non-connecté → `/connexion`.
  - `/admin/*` : `role === 'admin'` sinon 403 / redirection accueil.
  - procédures tRPC : `protectedProcedure` / `adminProcedure`.
- « Mot de passe oublié ? » : lien présent (design) mais **inactif en V1** (phase 2).
- Pas d'auto-inscription : les comptes sont créés par un admin (`/admin/utilisateurs`).

---

## 7. Zone admin (V1, rôle `admin`)

- **Magasins** (`/admin/magasins`) : liste + édition `name`, `basculeDate`, `currentStep`.
- **Formations** (`/admin/formations`) : CRUD catalogue (name, slug, tag, icon, description,
  kind, sharepointUrl, docCount, order).
- **Utilisateurs** (`/admin/utilisateurs`) : créer un compte (email, prénom, mot de passe
  initial, rôle), l'affecter à un magasin ; lister / désactiver.

UI admin sobre, cohérente avec les tokens Direction B mais sans fioritures éditoriales.

---

## 8. Déploiement Dokploy + Traefik

- Container **Next.js standalone**, `HOSTNAME=0.0.0.0`, healthcheck `wget 127.0.0.1:PORT`
  (IPv4, BusyBox).
- **Postgres** : **nouveau service dédié créé dans le docker-compose** du projet (pas de
  réutilisation d'un Postgres existant), volume persistant.
- Domaine déclaré **à la fois** dans l'UI Dokploy **et** les labels Traefik du compose
  (sinon router orphelin / 500).
- Vérifier le container **healthy** avant tout débogage Traefik (unhealthy → router invisible).
- **Dify** : autre container du même VPS, joint via réseau interne ; `DIFY_API_URL` pointe
  dessus. Pas de déploiement Dify dans ce repo.
- Variables d'env : `DATABASE_URL`, `AUTH_SECRET`, `DIFY_API_URL`, `DIFY_API_KEY`,
  `HOSTNAME`, `NODE_ENV`.
- **Auto-deploy** au merge sur `main` (Dokploy).

---

## 9. Fidélité visuelle & responsive

- **Tokens Direction B** (README) : couleurs (`bg #F4EEE3`, `surface #FBF7EF`, `card #FFF`,
  `ink #221C16`, `sub #8A7F6E`, `faint #B7AD9A`, `line #E4DBCB`, `red #C8102E`,
  `redSoft #F4E5E1`, `redInk #A20D24`, `sand #EADFC9`).
- **Typo** : Newsreader (serif éditorial) + Hanken Grotesk (UI), via Google Fonts /
  `next/font`.
- **Rayons** : pastilles 50% ; champs/boutons 10px ; cartes 14px ; grandes cartes 16–18px.
- **Icônes** : Lucide (proche du jeu SVG du proto). Logo APS = `assets/logo-aps.png` fourni.
- **Composants transverses** : `BNav` (barre de nav), `BRoute` (timeline 5 étapes
  Préparation · Formation · Tests · Bascule · Ouverture, prop `current`, prop `compact`).
- **Mobile** : accueil responsive + **barre d'onglets fixe basse** (Accueil / Former / BRAIN /
  Profil). Tous les écrans pensés responsive.
- Visuels de couverture = placeholders rayés en attendant de vraies photos.

---

## 10. Tests (TDD)

**Unitaires (logique pure)**
- Calcul `joursRestants` (J-N) à partir de `basculeDate`.
- Calcul `progressPercent` du parcours (`currentStep / 4`).
- Agrégat progression formations (« X/8 terminées »).
- Parsing du stream SSE Dify + mapping `retriever_resources` → sources.
- Guards rôle (employee vs admin).

**Composants / écrans**
- Les 5 écrans rendus avec données mockées.
- États : chargement BRAIN (streaming), erreur login, listes vides.

**Intégration (selon budget)**
- Flux auth (login → session → accès protégé).
- CRUD admin formations / magasins.

---

## 11. Découpage / phases

- **V1 (ce spec)** : auth, modèle de données complet, 5 écrans hifi, admin (magasins /
  formations / utilisateurs), BRAIN via Dify API, déploiement Dokploy. Formations en mode
  `sharepoint`.
- **Phase 2** : pages PDF dédiées (`formation_documents`, écran détail orienté téléchargement),
  reset mot de passe, suggestions BRAIN configurables en base, vraies photos de couverture.

---

## 12. Dépendances / prérequis externes

- Instance **Dify** opérationnelle sur le VPS avec une app chat + documents ingérés →
  fournir `DIFY_API_URL` + `DIFY_API_KEY`.
- **Postgres** accessible sur le VPS.
- **Dates J** par magasin (fournies par le client).
- Logo `logo-aps.png` (fourni dans le handoff).
