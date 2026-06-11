# Boot, Migrations & Offsite Backups (PR ④) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the infra/data findings from the 2026-06-09 audit: offsite S3/R2 backups (Postgres + uploads), hardened boot migrations (advisory lock + retry), graceful SIGTERM, log rotation, FK indexes + legacy table drop, orphaned-PDF cleanup on formation delete, HSTS.

**Architecture:** A new `backup` compose sidecar (own Dockerfile, POSIX shell script, curl sigv4 uploads to R2) handles backups fail-soft until the operator sets 4 envs. `scripts/migrate.mjs` gains connection retry + `pg_advisory_lock`. Migration 0009 drops the dead `user_formation_progress` table (user-approved) and adds two indexes. Everything else is small, targeted edits. Spec: `docs/superpowers/specs/2026-06-12-boot-backup-hardening-design.md`.

**Tech Stack:** Drizzle 0.45 / drizzle-kit 0.31, postgres-js, alpine + postgresql16-client + curl (`--aws-sigv4`), Docker compose (Dokploy), vitest.

**Conventions:** Branch `feat/boot-backup-hardening` (created, spec committed). Tests in `tests/` mirror `src/`. Single test file: `npx vitest run <path>`. Gate before each commit as stated per task. The local dev Postgres is the Docker container `formaps_postgres` on port 5433 (db/user/pass `cockpit`); Docker may or may not be running — tasks say what to do in each case.

---

### Task 1: Harden `scripts/migrate.mjs` (connection retry + advisory lock)

**Files:**
- Modify: `scripts/migrate.mjs` (full rewrite below)

No vitest harness (standalone ESM boot script — established project policy). Verification is by local execution against the dev Postgres.

- [ ] **Step 1: Rewrite the script**

Replace the entire content of `scripts/migrate.mjs` with:

```js
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[migrate] DATABASE_URL manquant')
  process.exit(1)
}

const RETRIES = Number(process.env.MIGRATE_RETRIES || 5)
const DELAY_MS = Number(process.env.MIGRATE_RETRY_DELAY_MS || 3000)
// Clé arbitraire constante du projet : sérialise les migrations entre containers.
const LOCK_KEY = 727274440

const sql = postgres(url, { max: 1 })

// La DB peut mettre quelques secondes à accepter les connexions après un
// restart (`depends_on` ne couvre que le premier start, pas les restarts de
// `restart: unless-stopped`) — retry avant d'abandonner, pour casser le
// crash-loop boot ↔ DB pas prête.
let ready = false
for (let attempt = 1; attempt <= RETRIES; attempt++) {
  try {
    await sql`SELECT 1`
    ready = true
    break
  } catch (err) {
    console.error(`[migrate] DB injoignable (tentative ${attempt}/${RETRIES}) : ${err.message}`)
    if (attempt < RETRIES) await new Promise((r) => setTimeout(r, DELAY_MS))
  }
}
if (!ready) {
  console.error(`[migrate] abandon après ${RETRIES} tentatives`)
  await sql.end()
  process.exit(1)
}

// Lock de session : deux containers qui bootent en même temps sérialisent
// leurs migrations (le second attend, puis trouve tout déjà appliqué). En cas
// de crash, le lock meurt avec la connexion — pas de lock orphelin.
await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
try {
  const db = drizzle(sql)
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('[migrate] migrations appliquées')
} catch (err) {
  console.error('[migrate] échec des migrations :', err)
  process.exit(1) // le lock de session est libéré par la mort de la connexion
}
await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`
await sql.end()
```

- [ ] **Step 2: Verify success path (db up)**

If Docker is available: `docker start formaps_postgres` then

Run: `$env:DATABASE_URL='postgres://cockpit:cockpit@localhost:5433/cockpit'; node scripts/migrate.mjs`
Expected: `[migrate] migrations appliquées`, exit 0.
(If Docker Desktop is unavailable, SKIP Steps 2-3 and note it in your report — the script is exercised at every CI-less prod boot; the retry path can also be reasoned from code.)

- [ ] **Step 3: Verify retry path (db down)**

Run: `docker stop formaps_postgres` then
`$env:DATABASE_URL='postgres://cockpit:cockpit@localhost:5433/cockpit'; $env:MIGRATE_RETRY_DELAY_MS='100'; node scripts/migrate.mjs; echo "exit=$LASTEXITCODE"`
Expected: 5 lines `[migrate] DB injoignable (tentative N/5)`, then `[migrate] abandon après 5 tentatives`, exit=1.
Then `docker start formaps_postgres` again (leave the dev db running) and clear the env override.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate.mjs
git commit -m "feat(boot): migrate.mjs connection retry + pg_advisory_lock"
```

---

### Task 2: Graceful SIGTERM + log rotation

**Files:**
- Modify: `Dockerfile` (CMD line, last line of the file)
- Modify: `docker-compose.yml` (logging blocks on `db` and `web`; the `backup` service added in Task 6 brings its own)

- [ ] **Step 1: Dockerfile — exec the server**

Replace the CMD line (and update the comment above it):

```dockerfile
# Run migrations, bootstrap the admin (env-driven, idempotent), then start the
# standalone server. Fail loud if migrate fails. `exec` makes node the shell's
# replacement process so Dokploy's SIGTERM reaches the server (graceful stop
# instead of the 10s timeout → SIGKILL).
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/bootstrap-admin.mjs && exec node server.js"]
```

- [ ] **Step 2: compose — bounded logs**

In `docker-compose.yml`, add to BOTH the `db` service and the `web` service (same indentation level as `restart:`):

```yaml
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 3: Validate compose syntax**

Run: `docker compose config --quiet` (if Docker is available; otherwise visually verify YAML indentation matches the service's other keys)
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat(infra): exec node server.js for graceful SIGTERM, bounded docker logs"
```

---

### Task 3: Migration 0009 — drop legacy table + FK indexes

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `drizzle/0009_*.sql` (generated; review only, no hand-edit expected)

Pre-verified at planning: `userFormationProgress` and `progressEnum` are referenced NOWHERE outside `schema.ts` (no src, no tests, no scripts). If your own grep finds a new usage, STOP and report BLOCKED.

- [ ] **Step 1: Re-verify dead code**

Run: `grep -rn "userFormationProgress\|user_formation_progress\|progressEnum" src/ tests/ scripts/ --include="*.ts" --include="*.tsx" --include="*.mjs"`
Expected: matches ONLY in `src/server/db/schema.ts` (3 lines).

- [ ] **Step 2: Edit the schema**

In `src/server/db/schema.ts`:
1. DELETE the line `export const progressEnum = pgEnum('progress_status', [...])` (line ~8).
2. DELETE the whole `export const userFormationProgress = pgTable('user_formation_progress', {...})` block (lines ~68-75, ends with `(t) => ({ uniqUserFormation: unique().on(t.userId, t.formationId) }))`). Check whether `unique` (the pg-core import) is still used elsewhere in the file after this deletion — if not, remove it from the import list (`npm run lint` will tell you).
3. `formationDocuments` table: add a third argument (object style):

```ts
}, (t) => ({
  // Chaque page formation liste ses documents par formation_id.
  formationIdIdx: index('formation_documents_formation_id_idx').on(t.formationId),
}))
```

4. `news` table: add a third argument:

```ts
}, (t) => ({
  // Liste publique : WHERE status = 'published' ORDER BY published_at DESC.
  statusPublishedAtIdx: index('news_status_published_at_idx').on(t.status, t.publishedAt),
}))
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: new `drizzle/0009_<name>.sql`. Read it FULLY and verify it contains exactly: `DROP TABLE "user_formation_progress"` (possibly with CASCADE), `DROP TYPE "public"."progress_status"`, and the two `CREATE INDEX` statements — and NOTHING destructive beyond that (no other DROP). If the generator asks an interactive question, abort and report BLOCKED with the prompt text.

- [ ] **Step 4: Apply locally if Docker available**

Run: `npm run db:migrate`
Expected: applies cleanly on the dev db (port 5433). If Docker unavailable, skip and note it (applies at prod boot, fail-loud policy).

- [ ] **Step 5: Full suite (schema change ripples)**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green (490 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(db): migration 0009 — drop legacy user_formation_progress, FK indexes"
```

---

### Task 4: `formations.delete` cleans up disk files

**Files:**
- Modify: `src/server/trpc/routers/admin.ts` (formations `delete` mutation, ~line 158)
- Test: `tests/server/admin-formations-delete.test.ts` (new)

Background: PDFs live at `${UPLOADS_DIR}/<docId>.pdf` (flat), formation covers at `${UPLOADS_DIR}/formations/<formationId>.<ext>`. `news.delete` (admin.ts ~439) already shows the best-effort cleanup pattern. The DB cascade erases `formation_documents` rows, so docIds MUST be collected before the delete.

- [ ] **Step 1: Write the failing tests**

Copy the caller/db mock plumbing from `tests/server/admin-stores-conflict.test.ts` (admin caller with mocked ctx.db). Mock `node:fs/promises` (the router imports `fs from 'node:fs/promises'` and `path from 'node:path'`). Tests:

```ts
// tests/server/admin-formations-delete.test.ts
// (plumbing adapted from admin-stores-conflict.test.ts; fs mocked)
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rm = vi.fn().mockResolvedValue(undefined)
const readdir = vi.fn().mockResolvedValue([])
vi.mock('node:fs/promises', () => ({
  default: { rm: (...a: unknown[]) => rm(...a), readdir: (...a: unknown[]) => readdir(...a) },
}))

const FORMATION_ID = '22222222-2222-4222-8222-222222222222'
const DOC_A = '33333333-3333-4333-8333-333333333333'
const DOC_B = '44444444-4444-4444-8444-444444444444'

// ... db mock: select chain returns [{id: DOC_A}, {id: DOC_B}],
//     delete chain returns [{ id: FORMATION_ID }] (the deleted row)

describe('admin.formations.delete — nettoyage disque', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readdir.mockResolvedValue([])
  })

  it('supprime le PDF de chaque document de la formation', async () => {
    await caller.formations.delete({ id: FORMATION_ID })
    const removed = rm.mock.calls.map((c) => String(c[0]).replace(/\\/g, '/'))
    expect(removed).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${DOC_A}.pdf`),
        expect.stringContaining(`${DOC_B}.pdf`),
      ]),
    )
  })

  it('supprime les fichiers de couverture <id>.* du dossier formations', async () => {
    readdir.mockResolvedValue([`${FORMATION_ID}.webp`, 'autre.webp'])
    await caller.formations.delete({ id: FORMATION_ID })
    const removed = rm.mock.calls.map((c) => String(c[0]).replace(/\\/g, '/'))
    expect(removed.some((p) => p.endsWith(`formations/${FORMATION_ID}.webp`))).toBe(true)
    expect(removed.some((p) => p.endsWith('formations/autre.webp'))).toBe(false)
  })

  it("un échec fs ne fait pas échouer la mutation (best-effort)", async () => {
    rm.mockRejectedValue(new Error('EACCES'))
    readdir.mockRejectedValue(new Error('ENOENT'))
    const result = await caller.formations.delete({ id: FORMATION_ID })
    expect(result).toEqual({ id: FORMATION_ID })
  })

  it('NOT_FOUND inchangé quand la formation est introuvable (aucun rm)', async () => {
    // delete chain returns [] for this test
    await expect(caller.formations.delete({ id: FORMATION_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(rm).not.toHaveBeenCalled()
  })
})
```

(Adapt the db mock so the select chain — `select().from().where()` awaitable — yields the doc rows, and the delete chain — `delete().where().returning()` — yields the formation row or `[]`. Keep the four assertions as written.)

- [ ] **Step 2: Run to verify red**

Run: `npx vitest run tests/server/admin-formations-delete.test.ts`
Expected: FAIL — current implementation never calls fs.

- [ ] **Step 3: Implement**

Replace the formations `delete` mutation in `src/server/trpc/routers/admin.ts`:

```ts
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Collecte AVANT le delete : la cascade DB efface formation_documents,
      // or les fichiers vivent à `${UPLOADS_DIR}/<docId>.pdf`.
      const docs = await ctx.db
        .select({ id: formationDocuments.id })
        .from(formationDocuments)
        .where(eq(formationDocuments.formationId, input.id))

      const [row] = await ctx.db
        .delete(formations)
        .where(eq(formations.id, input.id))
        .returning()

      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Formation introuvable' })

      // Nettoyage disque best-effort (même pattern que news.delete) : un échec
      // fs ne fait pas échouer la mutation — la cascade DB a déjà eu lieu.
      const dir = process.env.UPLOADS_DIR || '/app/uploads'
      await Promise.all(
        docs.map((d) => fs.rm(path.join(dir, `${d.id}.pdf`), { force: true }).catch(() => {})),
      )
      const coversDir = path.join(dir, 'formations')
      try {
        const entries = await fs.readdir(coversDir)
        await Promise.all(
          entries
            .filter((name) => name.startsWith(`${input.id}.`))
            .map((name) => fs.rm(path.join(coversDir, name), { force: true })),
        )
      } catch {
        // Dossier absent (aucune couverture jamais uploadée) — ignore.
      }

      return { id: input.id }
    }),
```

(`fs`, `path`, `formationDocuments`, `eq` are already imported in admin.ts.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/server/admin-formations-delete.test.ts && npm run typecheck`
Expected: 4/4 PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/admin.ts tests/server/admin-formations-delete.test.ts
git commit -m "fix(admin): formations.delete removes orphaned PDFs and cover files"
```

---

### Task 5: HSTS header

**Files:**
- Modify: `next.config.ts`
- Test: `tests/lib/next-config-headers.test.ts` (extend)

- [ ] **Step 1: Update the failing test**

In `tests/lib/next-config-headers.test.ts`, the `byKey` toEqual gains one entry:

```ts
    expect(byKey).toEqual({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Strict-Transport-Security': 'max-age=31536000',
    })
```

- [ ] **Step 2: Red run**

Run: `npx vitest run tests/lib/next-config-headers.test.ts`
Expected: FAIL (HSTS missing).

- [ ] **Step 3: Implement**

In `next.config.ts`, add to `securityHeaders` (and update the comment — HSTS is no longer "laissé à Traefik"):

```ts
  // Constat prod 2026-06-12 : Traefik ne pose PAS HSTS → émis par l'app.
  // L'app n'est servie qu'en HTTPS (Traefik websecure). Pas d'includeSubDomains
  // ni preload : hôte unique.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
```

Remove the now-wrong sentence « HSTS est laissé à Traefik (terminaison TLS). » from the block comment above.

- [ ] **Step 4: Green run + commit**

Run: `npx vitest run tests/lib/next-config-headers.test.ts`
Expected: PASS.

```bash
git add next.config.ts tests/lib/next-config-headers.test.ts
git commit -m "feat(security): emit HSTS app-side (Traefik does not set it)"
```

---

### Task 6: Backup sidecar (script + image + compose service)

**Files:**
- Create: `scripts/backup.sh`
- Create: `Dockerfile.backup`
- Modify: `docker-compose.yml` (new `backup` service)

- [ ] **Step 1: Write `scripts/backup.sh`** (LF line endings — add a `.gitattributes` entry if needed: check whether the repo has one; if not, create it with `scripts/backup.sh text eol=lf`)

```sh
#!/bin/sh
# Backup quotidien Cockpit : pg_dump (DB) + tar (volume uploads) → bucket S3/R2.
# Modes : `backup.sh once` — un run puis exit (test manuel) ;
#         `backup.sh loop` — un run puis sleep 24 h, indéfiniment (défaut compose).
# Fail-soft : envs BACKUP_S3_* absents → avertissement et attente, jamais de
# crash-loop. Un échec dump/upload est loggé et retenté au cycle suivant.
# Rétention : règle de lifecycle côté bucket (voir docs/DEPLOY.md), pas ici.
set -u

INTERVAL_S="${BACKUP_INTERVAL_S:-86400}"

log() { echo "[backup] $(date -u +%FT%TZ) $*"; }

config_ok() {
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && [ -n "${BACKUP_S3_BUCKET:-}" ] \
    && [ -n "${BACKUP_S3_ACCESS_KEY:-}" ] && [ -n "${BACKUP_S3_SECRET:-}" ]
}

# $1 = fichier local, $2 = clé distante
upload() {
  curl --fail --silent --show-error \
    --aws-sigv4 "aws:amz:auto:s3" \
    --user "${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET}" \
    --upload-file "$1" \
    "https://${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}/$2"
}

run_backup() {
  day="$(date -u +%F)"
  db_file="/tmp/db-${day}.dump"
  up_file="/tmp/uploads-${day}.tar.gz"

  if pg_dump --format=custom --file="$db_file" "$DATABASE_URL"; then
    log "pg_dump OK ($(du -h "$db_file" | cut -f1))"
    if upload "$db_file" "cockpit/db-${day}.dump"; then
      log "upload db OK -> cockpit/db-${day}.dump"
    else
      log "ERREUR upload db (retry au prochain cycle)"
    fi
  else
    log "ERREUR pg_dump (retry au prochain cycle)"
  fi
  rm -f "$db_file"

  if tar -czf "$up_file" -C /uploads .; then
    log "tar uploads OK ($(du -h "$up_file" | cut -f1))"
    if upload "$up_file" "cockpit/uploads-${day}.tar.gz"; then
      log "upload uploads OK -> cockpit/uploads-${day}.tar.gz"
    else
      log "ERREUR upload uploads (retry au prochain cycle)"
    fi
  else
    log "ERREUR tar uploads (retry au prochain cycle)"
  fi
  rm -f "$up_file"
}

mode="${1:-loop}"

if [ "$mode" = "once" ]; then
  if config_ok; then
    run_backup
    exit 0
  fi
  log "BACKUP_S3_* incomplets — rien a faire"
  exit 1
fi

while :; do
  if config_ok; then
    run_backup
  else
    log "AVERTISSEMENT : BACKUP_S3_* incomplets — backups offsite INACTIFS (poser les 4 envs dans l'UI Dokploy)"
  fi
  sleep "$INTERVAL_S"
done
```

- [ ] **Step 2: Write `Dockerfile.backup`**

```dockerfile
# Sidecar de backup Cockpit : pg_dump + tar du volume uploads → bucket S3/R2
# via curl --aws-sigv4 (compatible Cloudflare R2). Voir scripts/backup.sh.
FROM alpine:3.22
RUN apk add --no-cache postgresql16-client curl coreutils tzdata \
  && adduser -u 1001 -S backup
COPY scripts/backup.sh /backup.sh
RUN chmod 755 /backup.sh
USER backup
CMD ["/bin/sh", "/backup.sh", "loop"]
```

- [ ] **Step 3: Add the compose service**

In `docker-compose.yml`, after the `web` service:

```yaml
  backup:
    build:
      context: .
      dockerfile: Dockerfile.backup
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      # Backups offsite S3/R2 — les 4 envs sont à poser dans l'UI Dokploy.
      # Absents → le service logge un avertissement et reste inactif (fail-soft).
      BACKUP_S3_ENDPOINT: ${BACKUP_S3_ENDPOINT:-}
      BACKUP_S3_BUCKET: ${BACKUP_S3_BUCKET:-}
      BACKUP_S3_ACCESS_KEY: ${BACKUP_S3_ACCESS_KEY:-}
      BACKUP_S3_SECRET: ${BACKUP_S3_SECRET:-}
    volumes:
      # Lecture seule : le sidecar n'écrit jamais dans les uploads.
      - cockpit_uploads:/uploads:ro
    networks:
      - internal
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 4: Local validation (Docker required — if unavailable, report SKIPPED with reasoning)**

```powershell
docker build -f Dockerfile.backup -t cockpit-backup-test .
# Garde fail-soft (mode once sans envs) :
docker run --rm cockpit-backup-test sh /backup.sh once
# Attendu : « BACKUP_S3_* incomplets — rien a faire », exit 1.
# Dump réel contre le Postgres dev (host.docker.internal:5433) + upload vers des
# creds factices (l'upload DOIT échouer proprement, le dump DOIT réussir) :
docker run --rm `
  -e DATABASE_URL='postgres://cockpit:cockpit@host.docker.internal:5433/cockpit' `
  -e BACKUP_S3_ENDPOINT='example.invalid' -e BACKUP_S3_BUCKET='b' `
  -e BACKUP_S3_ACCESS_KEY='k' -e BACKUP_S3_SECRET='s' `
  -v /tmp:/uploads:ro `
  cockpit-backup-test sh /backup.sh once
# Attendu : « pg_dump OK (…) », « ERREUR upload db (retry au prochain cycle) »,
# « tar uploads OK », « ERREUR upload uploads », exit 0.
```

Also: `docker compose config --quiet` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup.sh Dockerfile.backup docker-compose.yml .gitattributes
git commit -m "feat(backup): daily offsite pg_dump + uploads tar to S3/R2 sidecar"
```

---

### Task 7: DEPLOY.md — backups & restore runbook

**Files:**
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Add a « Backups (offsite S3/R2) » section** (after the RGPD section), containing:

```markdown
## Backups (offsite S3/R2)

Le service compose `backup` (image `Dockerfile.backup`) exécute chaque jour :
`pg_dump -Fc` de la base + `tar.gz` du volume `cockpit_uploads`, uploadés vers un
bucket S3-compatible (Cloudflare R2). Sans configuration, le service reste
inactif et logge un avertissement (fail-soft).

### Mise en service (opérateur)

1. Créer un bucket R2 (ex. `cockpit-backups`) — Cloudflare Dashboard → R2.
2. Créer un token API R2 « Object Read & Write » limité à ce bucket ; noter
   l'Access Key ID / Secret Access Key et l'endpoint
   `https://<account-id>.r2.cloudflarestorage.com` (la valeur de
   `BACKUP_S3_ENDPOINT` est l'hôte SANS `https://`).
3. Règle de rétention : bucket → Settings → Object lifecycle rules → préfixe
   `cockpit/`, suppression après 30 jours.
4. Poser dans l'UI Dokploy : `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`,
   `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET`, puis redéployer.
5. Vérifier : `docker logs <container backup>` → `pg_dump OK` + `upload db OK`,
   et la présence des 2 objets du jour dans le bucket.

Test manuel à la demande : `docker exec <container backup> sh /backup.sh once`.

### Restauration

```bash
# 1. Récupérer les objets du jour voulu depuis le bucket (dashboard ou rclone).
# 2. Base (depuis un shell sur le VPS, fichier copié dans le container db) :
docker cp db-YYYY-MM-DD.dump <container db>:/tmp/restore.dump
docker exec <container db> pg_restore --clean --if-exists \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/restore.dump
# 3. Uploads (dans le container web) :
docker cp uploads-YYYY-MM-DD.tar.gz <container web>:/tmp/u.tar.gz
docker exec <container web> sh -c "tar -xzf /tmp/u.tar.gz -C /app/uploads"
# 4. Redémarrer le service web (sessions/JWT inchangés, aucune migration à rejouer
#    si le dump date de la même version de schéma ; sinon le boot ré-applique).
```
```

Adapt the surrounding heading levels to the file's existing structure (read it first).

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs(deploy): offsite backup setup and restore runbook"
```

---

### Task 8: Final gate, PR, CI, merge

- [ ] **Step 1: Full gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: 0 warnings, 0 errors, all tests green (~495).

- [ ] **Step 2: Build smoke**

Run: `npm run build` with the CI env placeholders (see `.github/workflows/ci.yml`).
Expected: success.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/boot-backup-hardening
gh pr create --title "Boot, migrations & offsite backups (audit 2026-06-09 — PR ④)" --body "<résumé contenu + notes de déploiement : 4 envs BACKUP_S3_* à poser, bucket R2 + lifecycle à créer, DROP user_formation_progress irréversible au boot (approuvé), vérifier HSTS via curl -I post-deploy, vérifier docker logs backup>"
```

(The controller composes the final PR body from the transversal review's deployment notes.)

- [ ] **Step 4: CI green then merge**

Run: `gh pr checks --watch` → green (never merge red), then `gh pr merge --merge`.

---

## Self-review notes

- Spec coverage: §1→T6+T7, §2→T1, §3→T2, §4→T2(+T6 logging), §5→T3, §6→T4, §7→T5. Complete.
- Type consistency: no shared types across tasks (script/sh/yaml are standalone); `formationDocuments.formationId` matches schema naming used in T3/T4.
- Known environment caveats encoded: Docker-optional steps marked skippable; backup.sh needs LF endings (gitattributes step); curl --aws-sigv4 requires curl ≥ 7.75 (alpine 3.22 ships ≥ 8.x).
