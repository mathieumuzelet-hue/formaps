# CI GitHub + typecheck (PR ② roadmap audit) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre un gate qualité sur les merges : workflow GitHub Actions (lint + typecheck + tests + build) qui passe au vert sur chaque PR et push main, après avoir soldé les 2 erreurs tsc connues.

**Architecture:** Un seul workflow `.github/workflows/ci.yml` avec un job unique séquentiel (fail-fast : lint → typecheck → test → build). Le build Next.js réutilise les placeholders d'env documentés dans le Dockerfile (`DATABASE_URL` + `AUTH_SECRET` factices — les modules serveur throwent à l'import sinon, aucune requête au build). Node 24 pour coller au runtime Docker (`node:24-alpine`).

**Tech Stack:** GitHub Actions (actions/checkout@v4, actions/setup-node@v4 avec cache npm), npm ci, tsc 5, eslint 9 flat config, vitest 4.

**Contexte vérifié le 2026-06-10 :**
- `npx tsc --noEmit` → exactement 2 erreurs, toutes deux ligne 61 de `tests/server/admin-users-password.test.ts` (TS2352 + TS2493) : le mock `updateSet = vi.fn(() => …)` est inféré zéro-argument, donc `mock.calls[0]` est le tuple vide `[]`.
- `npx eslint --max-warnings 0 .` → exit 0 (déjà propre, on peut verrouiller).
- `package-lock.json` présent → `npm ci` OK.
- Pas de dossier `.github` dans le repo.
- `tsconfig.json` inclut `.next/types/**/*.ts` : glob sans correspondance en CI (pas de `.next` avant build) — tsc ne s'en plaint pas car les autres includes matchent.

---

### Task 0: Branche de travail

- [ ] **Step 1: Créer la branche depuis main à jour**

```bash
git checkout main && git pull && git checkout -b ci/github-actions-typecheck
```

### Task 1: Solder les 2 erreurs tsc du test admin-users-password

**Files:**
- Modify: `tests/server/admin-users-password.test.ts:16` et `:61`

- [ ] **Step 1: Reproduire le rouge**

Run: `npx tsc --noEmit`
Expected: exit 2 avec exactement ces 2 erreurs :
```
tests/server/admin-users-password.test.ts(61,18): error TS2352 ...
tests/server/admin-users-password.test.ts(61,42): error TS2493 ...
```

- [ ] **Step 2: Typer l'argument du mock**

Ligne 16, remplacer :
```ts
const updateSet = vi.fn(() => ({ where: updateWhere }))
```
par :
```ts
const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }))
```

Ligne 61, remplacer :
```ts
  const setArg = updateSet.mock.calls[0][0] as Record<string, unknown>
```
par (le cast devient inutile, le tuple est maintenant typé) :
```ts
  const setArg = updateSet.mock.calls[0][0]
```

- [ ] **Step 3: Vérifier tsc propre**

Run: `npx tsc --noEmit`
Expected: exit 0, aucune sortie.

- [ ] **Step 4: Vérifier que le test passe toujours**

Run: `npx vitest run tests/server/admin-users-password.test.ts`
Expected: 5 tests PASS (dont « users.update SANS password → passwordChangedAt PAS touché »).

- [ ] **Step 5: Commit**

```bash
git add tests/server/admin-users-password.test.ts
git commit -m "fix(tests): type the updateSet mock arg so tsc passes"
```

### Task 2: Scripts npm `typecheck` + lint verrouillé à 0 warning

**Files:**
- Modify: `package.json:8-18` (bloc `scripts`)

- [ ] **Step 1: Ajouter le script et durcir le lint**

Dans `package.json`, remplacer :
```json
    "lint": "eslint",
```
par :
```json
    "lint": "eslint --max-warnings 0",
    "typecheck": "tsc --noEmit",
```

- [ ] **Step 2: Vérifier les deux scripts**

Run: `npm run typecheck && npm run lint`
Expected: exit 0 pour les deux, aucune erreur ni warning.

- [ ] **Step 3: Lancer la suite complète (filet avant CI)**

Run: `npm test`
Expected: 381 tests PASS (état au dernier merge).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add typecheck script and lock lint to zero warnings"
```

### Task 3: Workflow GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Écrire le workflow**

Contenu exact de `.github/workflows/ci.yml` :

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      # Placeholders identiques au Dockerfile : les modules serveur (db, auth)
      # throwent a l'import si absents, et `next build` evalue ces modules.
      # Aucune requete reelle au build — pages dynamiques (auth/tRPC).
      DATABASE_URL: postgres://build:build@localhost:5432/build
      AUTH_SECRET: build-placeholder-secret
      NEXT_TELEMETRY_DISABLED: '1'
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Tests
        run: npm test

      - name: Build
        run: npm run build
```

- [ ] **Step 2: Valider la syntaxe YAML localement**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');console.log(s.length>0?'file ok':'empty')"`
Expected: `file ok` (la vraie validation se fait au push, GitHub rejette un YAML invalide avec une annotation sur la page Actions).

- [ ] **Step 3: Vérifier que le build passe localement avec les mêmes placeholders**

Run (PowerShell) :
```powershell
$env:DATABASE_URL='postgres://build:build@localhost:5432/build'; $env:AUTH_SECRET='build-placeholder-secret'; npm run build
```
Expected: build Next.js OK (`✓ Compiled successfully` puis génération des pages), exit 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (lint + typecheck + tests + build)"
```

### Task 4: PR + vérification CI réelle

**Files:** aucun (opérations git/GitHub)

- [ ] **Step 1: Pousser la branche et ouvrir la PR**

```bash
git push -u origin ci/github-actions-typecheck
gh pr create --title "ci: GitHub Actions gate (lint + typecheck + tests + build)" --body "PR (2) de la roadmap audit 2026-06-09. Workflow CI sur push main + PR, script typecheck, lint --max-warnings 0, fix des 2 erreurs tsc connues du test admin-users-password."
```

- [ ] **Step 2: Attendre le run CI et vérifier le vert**

Run: `gh pr checks --watch`
Expected: le check `CI / checks` passe SUCCESS. Si rouge : NE PAS MERGER (voir [[feedback_no_merge_red_ci]]), corriger in-PR.

- [ ] **Step 3: Merger**

```bash
gh pr merge --squash --delete-branch
```
Expected: merge OK. Dokploy auto-déploie main (changement CI-only, sans impact runtime).

### Task 5: Tenter la branch protection sur main (best effort)

**Files:**
- Modify (si échec API): `docs/DEPLOY.md` (note process)

- [ ] **Step 1: Tenter de poser la protection exigeant le check CI**

```bash
gh api -X PUT repos/mathieumuzelet-hue/formaps/branches/main/protection -H "Accept: application/vnd.github+json" --input - <<'EOF'
{
  "required_status_checks": { "strict": false, "checks": [{ "context": "checks" }] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```
Expected: 200 si le plan GitHub le permet. **403 « Upgrade to GitHub Pro » attendu si repo privé sur plan Free** (voir [[feedback_github_advanced_security_private_repo_gated]] — gating analogue).

- [ ] **Step 2 (seulement si 403): Documenter le process manuel**

Ajouter à `docs/DEPLOY.md`, section déploiement :
```markdown
## Gate CI (process)

La branch protection GitHub n'est pas disponible sur ce repo (plan Free + repo privé).
Règle de process : **ne jamais merger une PR tant que le check `CI / checks` n'est pas
vert** (`gh pr checks` avant tout `gh pr merge`). Dokploy auto-déploie main sans gate.
```

- [ ] **Step 3: Commit (si Step 2 exécuté)**

```bash
git add docs/DEPLOY.md
git commit -m "docs: document the CI gate process (branch protection unavailable)"
git push
```

---

## Hors scope assumé (follow-ups audit, autres PRs)

- typecheck des scripts de boot `.mjs` (`checkJs` ouvrirait les configs JS, bruit ; finding MINOR)
- coverage vitest, `noUncheckedIndexedAccess`, cache mount npm Docker, tag node flottant
- PR ③ CSV, ④ boot/backup, ⑥ sécurité, ⑦ embed-lab (roadmap)
