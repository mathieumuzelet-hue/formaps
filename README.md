# FormA+Super

Portail web interne de la bascule **A⁺SUPER** (Auchan → Intermarché) : chaque
salarié suit le trajet de son magasin (compte à rebours J-N, parcours en 5
étapes), se forme sur les nouveaux outils, lit les actualités de l'enseigne
et interroge **BRAIN**, l'assistant IA documentaire (RAG via Dify).

## Fonctionnalités

### Côté salarié

- **Accueil** — Bonjour X, plus que N jours avant la bascule du
  magasin, parcours BRoute 5 étapes, raccourcis formations/BRAIN.
- **Espace Formation** — fiches par outil (Mercaly, CADAR+), documents PDF
  **consultables dans le navigateur** (bouton Consulter) ou téléchargeables.
  La **progression est automatique** : le pourcentage d'un
  formatage = documents consultés / documents totaux (pas de complétion manuelle).
- **Actualités** — La Gazette A⁺SUPER, articles façon journal avec image
  d'une.
- **BRAIN** — chat streaming branché sur un Dify auto-hébergé, réponses
  sourcées (passages cités), suggestions de questions, feedback
  👍/👎. Auto-réparation des conversations Dify casquées (mode
  changement, réinitialisation `chat_quiries` pour l'analyse FAQ-gaps
- **Compte** — changement de mot de passe self-service (invalidation JWT
  immédiate de toutes les sessions).

### Console admin (`/admin`)

- **Magasins** — date de bascule + étape courante, **import CSV en masse**
  (magasins + utilisateurs, mots de passe générés et exportables).
- **Formations** — CRUD, upload des documents PDF, **visuel de couverture**,
  ordre et badge ⭐ Nouveau.
- **Utilisateurs** — création, rattachement magasin, reset de mot de passe.
- **Actualités** — éditeur riche (TipTap), brouillon/publication, image d'une.
- **Suggestions BRAIN** — questions proposées dans le chat (réordonnables).
- **FAQ-gaps** — questions des 30 derniers jours sans source pertinente ou
  dislikées, regroupées et exportables en CSV ; le seuil de pertinence
  (`FAQ_RELEVANCE_THRESHOLD`, défaut 0.5) s'applique rétroactivement.
- **Labo d'embed** (`/admin/embed-test`) — banc d'essai des paramètres
  d'ingestion Dify : upload d'un PDF, verdict OCR (Claude vision), propositions
  de configs de chunking, simulation locale, jugement structurel par config,
  raffinement multi-tours et test de config manuel. Nécessite
  `ANTHROPIC_API_KEY`.
- **FAQ Builder** (`/admin/faq-builder`) — génération d'une FAQ depuis un
  document PDF ou .docx (Claude Sonnet 4.6) : brouillons persistants, éditeur
  des paires question/réponse (réordonnancement, ajout manuel, badges
  d'origine), **générer plus** (questions inédites, édit + retry), export
  **CSV au format Q&A de Dify** (la question de chaque paire est embarquée à
  l'import). Nécessite `ANTHROPIC_API_KEY`.
- **Pont Knowledge Dify** — depuis le FAQ Builder et l'écran Formations, bouton
  **Pousser vers Dify** par FAQ / document, avec badge d'état (synchro /
  en attente / échec). Alimente directement les bases de connaisances de BRAIN
  via l'**API Knowledge de Dify** (sens APP ↔ Dify) : une FAQ devient un
  document Q&A (paires en segments), un PDF de formation est uploadé dans la base
  documents. Push **idempotent** (re-push = mise à jour, pas de doublon),
  suppression de la source **propre** (Dify + table `dify_sync`). Nécessite une
  **clé dataset** spécifique
  `DIFY_DATASET_API_KEY` (distincte de la clé App `DIFY_API_KEY`) +
  `DIFY_QA_DATASET_ID` et `DIFY_DOCS_DATASET_ID`.

## Stack

- **Next.js 16** (App Router, output `standalone`) + React 19
- **tRPC 11** pour l'API type bout-en-bout
- **Drizzle ORM** + **Postgres** (driver `postgres`), migrations applicables au boot
- **Auth.js (next-auth v5)** — sessions JWT (claim `passwordChangedAt` vérifié
  côté Node à chaque requête), mots de passe argon2id
- **Tailwind CSS 4**, typographie Montserrat
- **Vitest** + Testing Library (~590 tests) ; **CI GitHub Actions**
  (lint + typecheck + tests + build) requiert sur chaque PR et push `main`
- **BRAIN** : proxy SSE serveur (`/api/brain`) vers un contenu **Dify**
  séparé (`DIFY_API_URL`) — timeout de connexion, auto-heal discipliné par
  code d'erreur, journalisation `chat_quiries` pour l'analyse FAQ-gaps
- **Outils Claude** (labo d'embed, FAQ Builder) : SDK Anthropic en tool use
  forcé via le curateur partenaire `src/server/claude-core.ts` (détection des sorties
  tronquées à `max_tokens`), extraction `unpdf` (PDF) / `mammoth` (.docx),
  simulation de chunking `gpt-tokenizer` — aucun appel à l'API Dify

## Architecture (points notables)

- `src/app/api/brain/route.ts` — proxy streaming SSE : relayer les octets tels
  quels, inspecter les frames en parallèle (capture du `conversation_id` au
  `message_end`, log FAQ, self-heal des conversations empoisonnées).
- `src/app/api/documents/[docId]/download` — sert les PDF inline (visionneuse
  navigateur) ou en téléchargement (`?download=1`) ; chaque accès alimente la
  table `user_document_views` qui porte la progression.
- Uploads (PDF de formation, images d'une/couverture) sur le volume persistant
  `UPLOADS_DIR` (`/app/uploads` en prod).
- Middleware Edge **signature-only** ; la fraîcheur de session (mot de passe
  changé) est vérifiée côté Node — la page `/connexion` est toujours accessible
  pour éviter tout blocage de redirection.
- `src/server/dify/knowledge.ts` — client de l'**API Knowledge Dify**, distinct
  du client App (`client.ts`) et authentifié par une **clé dataset** spécifique.
  La table `dify_sync` (polymorphe, sans FK) mappe chaque source poussée
  (FAQ / document de formation) vers son document Dify et son état de synchro ;
  le routeur `difySync` (admin) orchestre push / unsync / statut.

## Développement local

Prérequis : Node ≥ 20, Docker.

1. **Base de données dev** (Postgres sur le port `5433`) :

   ```bash
   docker run -d --name formaps_postgres \
     -e POSTGRES_USER=cockpit -e POSTGRES_PASSWORD=cockpit -e POSTGRES_DB=cockpit \
     -p 5433:5432 postgres:16-alpine
   ```

2. **Variables d'environnement** : copier `.env.example` vers `.env` et renseigner
   les valeurs (au minimum `DATABASE_URL`, `AUTH_SECRET` ; `DIFY_API_URL`/`DIFY_API_KEY`
   pour BRAIN, `ANTHROPIC_API_KEY` pour le labo d'embed). Générer un secret :

   ```bash
   openssl rand -base64 32
   ```

3. **Migrations + seed** :

   ```bash
   npm install
   npm run db:migrate
   npm run db:seed
   ```

4. **Lancer le serveur de dev** :

   ```bash
   npm run dev
   ```

   Ouvrir http://localhost:3000.

### Identifiants après seed (DEV uniquement)

- **admin@apps.fr** / **admin1234**

> Ces identifiants sont des valeurs de seed pour le développement. Ne jamais les
> utiliser en production (le seed refuse de s'exécuter en prod ; créez les
> comptes via l'admin ou le bootstrap).

## Tests

```bash
npm test          # vitest run (~590 tests)
npm run typecheck # tsc --noEmit
npm run lint      # eslint --max-warnings 0 (docs/ ignoré : prototypes de design)
npm run build      # build de production
```

## Déploiement

Le déploiement se fait via **Dokploy** (Docker + docker-compose, derrière
Traefik), auto-déclenché au merge sur `main`. Au boot du conteneur :
migrations Drizzle poussées par bootstrap du compte admin, avant le démarrage du
serveur. Voir le guide complet : [`docs/DEPLOY.md`](docs/DEPLOY.md).

Les audits de code et plans d'implémentation vivent dans
[`docs/reviews/`](docs/reviews/) et [`docs/superpowers/`](docs/superpowers/).