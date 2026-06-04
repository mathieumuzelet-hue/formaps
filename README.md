# Cockpit

Portail web de la bascule **A⁺SUPER** : espace formation, suivi de progression,
actualités et assistant **BRAIN** (RAG via Dify). Construit en Next.js 16.

## Stack

- **Next.js 16** (App Router, output `standalone`) + React 19
- **tRPC 11** pour l'API typée bout-en-bout
- **Drizzle ORM** + **Postgres** (driver `postgres`)
- **Auth.js (next-auth v5)** — sessions JWT, mots de passe argon2id
- **Tailwind CSS 4**
- **Vitest** + Testing Library
- Assistant **BRAIN** branché sur un conteneur **Dify** séparé (`DIFY_API_URL`)

## Développement local

Prérequis : Node ≥ 20, Docker.

1. **Base de données dev** (Postgres sur le port `5433`) :

   ```bash
   docker run -d --name formaps_postgres \
     -e POSTGRES_USER=cockpit -e POSTGRES_PASSWORD=cockpit -e POSTGRES_DB=cockpit \
     -p 5433:5432 postgres:16-alpine
   ```

2. **Variables d'environnement** : copier `.env.example` vers `.env` et renseigner
   les valeurs (au minimum `DATABASE_URL`, `AUTH_SECRET`). Générer un secret :

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

- **admin@aps.fr** / **admin1234**

> Ces identifiants sont des valeurs de seed pour le développement. Ne jamais les
> utiliser en production (le seed n'est pas exécuté en prod ; créez les comptes
> via l'admin).

## Tests

```bash
npm test          # vitest run
npm run lint      # eslint (le dossier docs/ est ignoré : prototypes de design)
npm run build     # build de production
```

## Déploiement

Le déploiement se fait via **Dokploy** (Docker + docker-compose, derrière
Traefik). Les migrations sont appliquées automatiquement au démarrage du
conteneur. Voir le guide complet : [`docs/DEPLOY.md`](docs/DEPLOY.md).
