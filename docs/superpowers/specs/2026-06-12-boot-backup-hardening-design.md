# Spec — PR ④ Boot, migrations & backups offsite

**Date** : 2026-06-12
**Origine** : audit complet 2026-06-09 (PR ④ de la roadmap consolidée) + constat prod
post-PR #14 (HSTS absent).
**Décisions utilisateur** : backups **offsite S3/R2** ; **DROP de `user_formation_progress`**
(table legacy) approuvé.

## Objectif

Fermer les findings infra/données : aucune stratégie de backup, crash-loop possible des
migrations au boot, SIGKILL au redeploy, logs Docker non bornés, index FK manquants,
PDF orphelins à la suppression d'une formation, HSTS manquant.

## 1. Backup offsite quotidien (Postgres + uploads)

**Fichiers** : nouveau `Dockerfile.backup`, nouveau `scripts/backup.sh`,
`docker-compose.yml` (service `backup`), `docs/DEPLOY.md`.

- **Image** : `Dockerfile.backup` — `FROM alpine:3.22`, `apk add postgresql16-client
  curl coreutils tzdata`, copie `scripts/backup.sh`, user non-root, `CMD ["/bin/sh",
  "/backup.sh", "loop"]`.
- **Script `backup.sh`** (POSIX sh) :
  - mode `loop` : exécute un backup puis dort 24 h, indéfiniment ;
  - mode `once` : un seul backup puis exit (test manuel / restauration de confiance) ;
  - garde de configuration : si l'un des envs `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET`
    / `BACKUP_S3_ACCESS_KEY` / `BACKUP_S3_SECRET` est vide → log d'avertissement
    explicite et sleep (fail-soft, PAS de crash-loop tant que les clés ne sont pas
    posées dans Dokploy) ;
  - backup DB : `pg_dump -Fc` via `DATABASE_URL` (fourni par le compose, comme web) →
    `/tmp/db-<YYYY-MM-DD>.dump` ;
  - backup uploads : `tar -czf /tmp/uploads-<YYYY-MM-DD>.tar.gz -C /uploads .`
    (volume `cockpit_uploads` monté **read-only** sur `/uploads`) ;
  - upload : `curl --fail --aws-sigv4 "aws:amz:auto:s3"` (PUT, compatible R2) vers
    `https://$BACKUP_S3_ENDPOINT/$BACKUP_S3_BUCKET/cockpit/db-<date>.dump` et
    `.../cockpit/uploads-<date>.tar.gz` ;
  - chaque étape logge succès/échec avec taille du fichier ; un échec d'upload NE
    crash PAS le service (retry au prochain cycle) ; les fichiers temporaires sont
    supprimés après upload (succès ou échec).
- **Rétention** : règle de **lifecycle côté bucket R2** (ex. expiration 30 jours sur le
  préfixe `cockpit/`), documentée pas à pas dans DEPLOY.md — pas de code de purge
  distant.
- **Compose** : service `backup` (build `Dockerfile.backup`), `restart: unless-stopped`,
  réseau `internal` seul, `depends_on: db: service_healthy`, volumes
  `cockpit_uploads:/uploads:ro`, envs `DATABASE_URL` + les 4 `BACKUP_S3_*`
  (mappés `${VAR:-}` — leçon FAQ_RELEVANCE_THRESHOLD).
- **DEPLOY.md** : section « Backups » — création du bucket R2, token API S3, lifecycle,
  les 4 envs Dokploy, test `docker exec <backup> sh /backup.sh once`, et la
  **procédure de restauration** complète (`pg_restore --clean --if-exists` + untar
  uploads).
- **Validation** : pas de vitest sur du shell — exécution locale Docker du mode `once`
  contre le Postgres local (upload réel seulement si l'opérateur fournit des clés ;
  sinon vérifier la garde fail-soft + la production des fichiers dump/tar).

## 2. `migrate.mjs` durci (lock + retry)

**Fichier** : `scripts/migrate.mjs` (reste un script ESM autonome — pas de module
partagé ; la logique retry/backoff est inline, paramétrée par envs pour la
testabilité manuelle).

- **Retry de connexion** : 5 tentatives espacées de 3 s (configurable
  `MIGRATE_RETRIES` / `MIGRATE_RETRY_DELAY_MS`) autour d'un `SELECT 1` de sonde ;
  épuisement → message explicite + exit 1. Casse le crash-loop « DB pas prête »
  (depends_on ne protège qu'au premier start, pas aux restarts).
- **Advisory lock** : `SELECT pg_advisory_lock(727274440)` (clé constante arbitraire
  du projet) avant `migrate()`, `pg_advisory_unlock` après — deux containers qui
  bootent simultanément sérialisent leurs migrations. Connexion `max: 1` déjà en
  place (le lock est de session).
- Les erreurs de migration restent fail-loud (exit 1, message explicite préfixé
  `[migrate]`).

## 3. SIGTERM propre

**Fichier** : `Dockerfile` — CMD devient
`["sh", "-c", "node scripts/migrate.mjs && node scripts/bootstrap-admin.mjs && exec node server.js"]`.
`exec` fait du serveur le PID 1 du `sh` : SIGTERM des redeploys Dokploy atteint Node
(arrêt gracieux, plus de SIGKILL après timeout).

## 4. Rotation des logs

**Fichier** : `docker-compose.yml` — bloc `logging: { driver: json-file, options:
{ max-size: "10m", max-file: "3" } }` sur `db`, `web` et `backup`.

## 5. Migration 0009 — index FK + DROP legacy

**Fichiers** : `src/server/db/schema.ts`, `drizzle/0009_*.sql`.

- Index `formation_documents_formation_id_idx` sur `formation_documents(formation_id)`.
- Index `news_status_published_at_idx` sur `news(status, published_at)`.
- **DROP TABLE `user_formation_progress`** (+ retrait du schéma Drizzle et de tout
  type/export associé) — table morte depuis la PR #7 (progression auto via
  `user_document_views`), plus aucun code ne la lit/écrit (à re-vérifier par grep au
  moment de l'implémentation ; si un usage résiduel apparaît, STOP et le signaler).
  Approuvé explicitement par l'utilisateur. Perte assumée : anciens états « terminé »
  manuels, déjà invisibles dans l'UI.
- `user_document_views` : rien à faire (PK composite existante).

## 6. `formations.delete` nettoie le disque

**Fichier** : `src/server/trpc/routers/admin.ts`.

- AVANT le delete : `SELECT id FROM formation_documents WHERE formation_id = $1`
  (les fichiers vivent à `${UPLOADS_DIR}/<docId>.pdf`).
- Après le delete DB réussi : `fs.rm` best-effort de chaque `<docId>.pdf` ET des
  fichiers de couverture `${UPLOADS_DIR}/formations/<id>.*` — même pattern
  try/catch-silencieux que `news.delete` (admin.ts:445-456).
- Best-effort : un échec disque ne fait pas échouer la mutation (la cascade DB a
  déjà eu lieu).

## 7. HSTS app-side

**Fichier** : `next.config.ts` — ajout
`{ key: "Strict-Transport-Security", value: "max-age=31536000" }` au set existant.
Constat prod 2026-06-12 : Traefik ne pose pas HSTS. L'app n'est servie qu'en HTTPS
(redirection Traefik), le header est donc toujours émis sous TLS. Pas de
`includeSubDomains` ni `preload` (hôte unique `cockpit.apsbot.fr`).

## Hors scope (assumé)

Backup de la base Dify (autre projet Dokploy) ; chiffrement des dumps (bucket privé
R2 suffit pour ce produit) ; monitoring/alerting des backups (follow-up possible :
heartbeat) ; PR ③ CSV ; PR ⑦ embed-lab.

## Tests

- `formations.delete` : rm appelé pour chaque docId + couverture, best-effort (échec
  disque ≠ échec mutation), NOT_FOUND inchangé — étendre le fichier de tests admin
  existant ou en créer un dédié.
- `next.config` : test headers existant étendu (HSTS présent).
- Migration 0009 : `npm run db:generate` + relecture du SQL (DROP + 2 index) +
  `db:migrate` sur le Postgres local si Docker dispo.
- `migrate.mjs` : pas de harnais vitest (script ESM autonome) — validation par
  exécution locale : (a) DB up → migrations OK ; (b) DB down → 5 retries puis exit 1.
- `backup.sh` : exécution Docker locale du mode `once` (garde fail-soft sans envs ;
  avec envs factices → dump/tar produits, upload échoue proprement).
- Suite complète + lint + typecheck + build placeholders avant push.

## Déploiement / opérateur (checklist à reporter dans la PR)

1. Créer le bucket R2 + token API S3 (lecture/écriture sur le bucket).
2. Poser la règle lifecycle (expiration 30 j, préfixe `cockpit/`).
3. Poser `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`,
   `BACKUP_S3_SECRET` dans l'UI Dokploy.
4. Après déploiement : `docker logs <backup>` (premier backup OK) puis vérifier les
   2 objets dans le bucket ; test de restauration recommandé.
5. Migration 0009 : DROP irréversible de `user_formation_progress` au boot.
