# Cockpit — Portail Bascule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le portail interne « Cockpit » (bascule Auchan → Intermarché, marque A⁺SUPER) : 5 écrans hifi + admin + chat BRAIN branché sur Dify, déployable sur Dokploy/Traefik.

**Architecture:** Monolithe Next.js 16 (App Router) fullstack. tRPC pour l'API typée, Drizzle + Postgres pour la persistance, Auth.js v5 (credentials, argon2id) pour l'auth. BRAIN appelle Dify via une route serveur qui proxifie le streaming SSE. Un container Next.js standalone + un Postgres dédié dans le docker-compose.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, tRPC v11, Drizzle ORM, PostgreSQL, Auth.js v5 (next-auth), argon2, Lucide icons, Vitest + Testing Library, Docker.

**Référence design :** `docs/handoff/README.md` (tokens, specs écran par écran) et `docs/handoff/directions/{shared,dirB}.jsx` (code React de référence hifi à porter). `docs/handoff/assets/logo-aps.png` = logo fourni.

**Spec :** `docs/superpowers/specs/2026-06-04-cockpit-portail-design.md`.

---

## File Structure (cible)

```
src/
  app/
    layout.tsx                  # root layout : fonts, providers, html lang=fr
    globals.css                 # tokens Direction B en variables CSS + Tailwind
    (auth)/connexion/page.tsx   # LoginB
    (app)/layout.tsx            # layout connecté : BNav + transition route
    (app)/page.tsx              # HomeB (accueil)
    (app)/formations/page.tsx   # FormB
    (app)/formations/[slug]/page.tsx  # FormDetailB
    (app)/brain/page.tsx        # BrainB
    admin/layout.tsx            # garde role=admin
    admin/magasins/page.tsx
    admin/formations/page.tsx
    admin/utilisateurs/page.tsx
    api/auth/[...nextauth]/route.ts
    api/trpc/[trpc]/route.ts
    api/brain/route.ts          # proxy streaming Dify
  components/
    nav/BNav.tsx
    route/BRoute.tsx
    ui/Icon.tsx                 # wrapper Lucide + map noms du proto
    ui/ImgSlot.tsx              # placeholder rayé
    ui/ApsLogo.tsx
    brain/                      # bulles, sources, suggestions, input
    home/  formations/  admin/  # sous-composants par écran
  server/
    db/schema.ts                # tables Drizzle
    db/index.ts                 # client drizzle
    db/seed.ts                  # seed dev
    auth.ts                     # config Auth.js
    trpc/trpc.ts                # init, procedures (public/protected/admin)
    trpc/root.ts                # appRouter
    trpc/routers/{store,formation,progress,brain,admin}.ts
    dify/client.ts              # appel + parsing stream Dify
  lib/
    bascule.ts                  # calculs J-N, %
    progress.ts                 # agrégats progression
    design/tokens.ts            # tokens TS (couleurs, STAGES)
  middleware.ts                 # protection routes
tests/                          # miroir de src/ pour Vitest
drizzle/                        # migrations générées
Dockerfile  docker-compose.yml  .dockerignore  drizzle.config.ts
```

Principe : un fichier = une responsabilité. La logique pure (`lib/`, `server/dify`) est isolée et testée en premier ; les écrans portent le visuel depuis la référence.

---

## M0 — Scaffold & tooling

### Task 0.1: Initialiser le projet Next.js + dépendances

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.nvmrc`

- [ ] **Step 1: Scaffolder** dans le repo existant (déjà `git init`).

```bash
cd C:/Users/mathi/formaps
# créer l'app dans un dossier temp puis remonter les fichiers (le repo n'est pas vide : docs/ présent)
npx create-next-app@latest .tmp-app --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --no-turbopack --use-npm
```

- [ ] **Step 2: Remonter** le contenu de `.tmp-app/` à la racine (sans écraser `docs/`, `.git/`), puis supprimer `.tmp-app/`. Conserver `src/`, `public/`, `next.config.ts`, `tsconfig.json`, `package.json`, `eslint.config.mjs`, `postcss.config.mjs`.

- [ ] **Step 3: Installer les dépendances métier.**

```bash
npm i @trpc/server @trpc/client @trpc/react-query @tanstack/react-query zod \
  drizzle-orm postgres next-auth@beta @auth/drizzle-adapter argon2 lucide-react superjson
npm i -D drizzle-kit vitest @vitejs/plugin-react @testing-library/react \
  @testing-library/jest-dom @testing-library/user-event jsdom @types/node
```

- [ ] **Step 4: Pin Node** dans `.nvmrc` (`24`) et `package.json` engines `"node": ">=20"`.

- [ ] **Step 5: Vérifier le build de base.**

Run: `npm run build`
Expected: build Next.js réussi (page d'accueil par défaut).

- [ ] **Step 6: Commit.**

```bash
git add -A && git commit -m "chore: scaffold Next.js 16 + deps (trpc, drizzle, auth)"
```

### Task 0.2: Configurer Vitest

**Files:**
- Create: `vitest.config.ts`, `tests/setup.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Écrire `vitest.config.ts`.**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
  resolve: { alias: { '@': resolve(__dirname, './src') } },
})
```

- [ ] **Step 2: Écrire `tests/setup.ts`.**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 3: Ajouter scripts** dans `package.json` : `"test": "vitest run"`, `"test:watch": "vitest"`, `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`, `"db:seed": "tsx src/server/db/seed.ts"`. Installer `tsx` en dev (`npm i -D tsx`).

- [ ] **Step 4: Sanity test.** Create `tests/sanity.test.ts`:

```ts
import { expect, test } from 'vitest'
test('sanity', () => { expect(1 + 1).toBe(2) })
```

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "chore: configure vitest"`

---

## M1 — Tokens design & primitives UI

### Task 1.1: Tokens Direction B (CSS + TS)

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/lib/design/tokens.ts`

- [ ] **Step 1: Écrire les tokens TS** (source : `docs/handoff/README.md` §Design tokens et `dirB.jsx` objet `B`).

```ts
// src/lib/design/tokens.ts
export const COLORS = {
  bg: '#F4EEE3', surface: '#FBF7EF', card: '#FFFFFF',
  ink: '#221C16', sub: '#8A7F6E', faint: '#B7AD9A',
  line: '#E4DBCB', red: '#C8102E', redSoft: '#F4E5E1',
  redInk: '#A20D24', sand: '#EADFC9',
} as const

export const STAGES = ['Préparation', 'Formation', 'Tests', 'Bascule', 'Ouverture'] as const
export type StageIndex = 0 | 1 | 2 | 3 | 4
```

- [ ] **Step 2: Déclarer les variables CSS + fonts** dans `globals.css` : mapper chaque couleur en `--color-*` exposée à Tailwind 4 via `@theme`, et déclarer les familles `--font-serif` (Newsreader) / `--font-sans` (Hanken Grotesk). Charger les fonts via `next/font/google` dans le root layout (Task 1.2), pas via `<link>`.

```css
@import "tailwindcss";
@theme {
  --color-bg: #F4EEE3; --color-surface: #FBF7EF; --color-card: #FFFFFF;
  --color-ink: #221C16; --color-sub: #8A7F6E; --color-faint: #B7AD9A;
  --color-line: #E4DBCB; --color-red: #C8102E; --color-redsoft: #F4E5E1;
  --color-redink: #A20D24; --color-sand: #EADFC9;
}
:root { color-scheme: light; }
body { background: var(--color-bg); color: var(--color-ink); }
```

- [ ] **Step 3: Test** que les tokens sont stables (anti-régression).

```ts
// tests/lib/tokens.test.ts
import { COLORS, STAGES } from '@/lib/design/tokens'
import { expect, test } from 'vitest'
test('tokens couleurs Direction B', () => {
  expect(COLORS.red).toBe('#C8102E')
  expect(COLORS.bg).toBe('#F4EEE3')
})
test('parcours = 5 étapes', () => { expect(STAGES).toHaveLength(5) })
```

Run: `npm test tests/lib/tokens.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit.** `git commit -am "feat: design tokens Direction B"`

### Task 1.2: Root layout + fonts

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Configurer les fonts Google** via `next/font/google` : `Newsreader` (weights 400–600, variable `--font-serif`) et `Hanken_Grotesk` (400–800, `--font-sans`). `lang="fr"`. Appliquer `font-sans` au body.

- [ ] **Step 2: Vérifier.** Run `npm run build`. Expected: build OK.
- [ ] **Step 3: Commit.** `git commit -am "feat: root layout + fonts Newsreader/Hanken"`

### Task 1.3: Composant Icon (Lucide)

**Files:**
- Create: `src/components/ui/Icon.tsx`, `tests/components/Icon.test.tsx`

Le proto utilise des noms d'icônes maison (`compass`, `brain`, `arrowR`, `download`, `external`, `file`, `send`, `book`, `cart`, `box`, `euro`, `layers`, `user`, `truck`, `headset`, `shield`, `clock`, `bell`, `search`, `check`, `chevronL`). On mappe vers Lucide.

- [ ] **Step 1: Écrire le test** du mapping.

```tsx
// tests/components/Icon.test.tsx
import { render } from '@testing-library/react'
import { Icon } from '@/components/ui/Icon'
import { expect, test } from 'vitest'
test('rend une icône connue sans crash', () => {
  const { container } = render(<Icon name="compass" size={20} />)
  expect(container.querySelector('svg')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run** `npm test tests/components/Icon.test.tsx` → FAIL (module absent).

- [ ] **Step 3: Implémenter** `Icon` : map `name → composant Lucide` (`compass→Compass`, `brain→Brain`, `arrowR→ArrowRight`, `download→Download`, `external→ExternalLink`, `file→FileText`, `send→Send`, `book→BookOpen`, `cart→ShoppingCart`, `box→Package`, `euro→Euro`, `layers→Layers`, `user→User`, `truck→Truck`, `headset→Headset`, `shield→Shield`, `clock→Clock`, `bell→Bell`, `search→Search`, `check→Check`, `chevronL→ChevronLeft`). Props `name, size=22, color='currentColor', strokeWidth=1.7`.

- [ ] **Step 4: Run** le test → PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat: Icon wrapper Lucide"`

### Task 1.4: ApsLogo + ImgSlot

**Files:**
- Create: `src/components/ui/ApsLogo.tsx`, `src/components/ui/ImgSlot.tsx`
- Copy: `docs/handoff/assets/logo-aps.png` → `public/logo-aps.png`

- [ ] **Step 1: Copier le logo** dans `public/`. `ApsLogo` = `next/image` sur `/logo-aps.png`, prop `height` (def 28), `width:auto`, `alt="A+SUPER"`.
- [ ] **Step 2: Porter `ImgSlot`** depuis `docs/handoff/directions/shared.jsx` (placeholder rayé `repeating-linear-gradient`), props `label, width, height, radius, accent, tone`.
- [ ] **Step 3: Smoke test** rendu des deux (pas de crash).
- [ ] **Step 4: Commit.** `git commit -am "feat: ApsLogo + ImgSlot placeholder"`

### Task 1.5: BRoute (timeline parcours)

**Files:**
- Create: `src/components/route/BRoute.tsx`, `tests/components/BRoute.test.tsx`

- [ ] **Step 1: Écrire le test** : `current=1` → étape 0 marquée terminée (coche), étape 1 courante, libellés affichés ; `compact` masque les libellés.

```tsx
import { render, screen } from '@testing-library/react'
import { BRoute } from '@/components/route/BRoute'
import { expect, test } from 'vitest'
test('affiche les 5 libellés hors compact', () => {
  render(<BRoute current={1} />)
  expect(screen.getByText('Formation')).toBeInTheDocument()
  expect(screen.getByText('Préparation')).toBeInTheDocument()
})
test('compact masque les libellés', () => {
  render(<BRoute current={1} compact />)
  expect(screen.queryByText('Formation')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Porter `BRoute`** depuis `dirB.jsx` (lignes 52–74) : ligne de fond `line`, ligne de progression rouge largeur `current/(N-1)*84%`, pastilles done/on/upcoming, prop `compact`. Convertir les styles inline en classes Tailwind + tokens.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat: BRoute timeline parcours"`

---

## M2 — Base de données

### Task 2.1: Schéma Drizzle

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/db/index.ts`, `drizzle.config.ts`, `.env.example`

- [ ] **Step 1: Écrire `schema.ts`** (tables du spec §4).

```ts
import { pgTable, uuid, text, integer, date, timestamp, boolean, pgEnum, unique } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ['employee', 'admin'])
export const kindEnum = pgEnum('formation_kind', ['sharepoint', 'pdf'])
export const progressEnum = pgEnum('progress_status', ['not_started', 'in_progress', 'done'])

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  basculeDate: date('bascule_date').notNull(),
  currentStep: integer('current_step').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  role: roleEnum('role').notNull().default('employee'),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
  difyConversationId: text('dify_conversation_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const formations = pgTable('formations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  tag: text('tag').notNull(),
  icon: text('icon').notNull(),
  description: text('description').notNull(),
  kind: kindEnum('kind').notNull().default('sharepoint'),
  sharepointUrl: text('sharepoint_url'),
  docCount: integer('doc_count').notNull().default(0),
  order: integer('order').notNull().default(0),
})

export const formationDocuments = pgTable('formation_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  formationId: uuid('formation_id').notNull().references(() => formations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  pages: integer('pages').notNull(),
  sizeLabel: text('size_label').notNull(),
  fileUrl: text('file_url').notNull(),
  isNew: boolean('is_new').notNull().default(false),
  order: integer('order').notNull().default(0),
})

export const userFormationProgress = pgTable('user_formation_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  formationId: uuid('formation_id').notNull().references(() => formations.id, { onDelete: 'cascade' }),
  status: progressEnum('status').notNull().default('not_started'),
  progressPercent: integer('progress_percent').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({ uniqUserFormation: unique().on(t.userId, t.formationId) }))
```

- [ ] **Step 2: Écrire `db/index.ts`** (client `postgres` + `drizzle`, lit `DATABASE_URL`).
- [ ] **Step 3: Écrire `drizzle.config.ts`** (dialect postgres, schema path, out `./drizzle`).
- [ ] **Step 4: `.env.example`** : `DATABASE_URL`, `AUTH_SECRET`, `DIFY_API_URL`, `DIFY_API_KEY`.
- [ ] **Step 5: Générer la migration.** Run `npm run db:generate`. Expected: fichiers SQL créés dans `drizzle/`.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: schéma Drizzle (stores, users, formations, progress)"`

### Task 2.2: Seed dev

**Files:**
- Create: `src/server/db/seed.ts`

- [ ] **Step 1: Écrire le seed** : 1 magasin « Magasin de Lille » (`basculeDate` = aujourd'hui + 18 jours, `currentStep=1`), 8 formations (data de `shared.jsx` `TRAININGS`), 1 admin (`admin@aps.fr`) + 1 employé (`camille@aps.fr`, prénom Camille, rattaché Lille) avec mots de passe hashés argon2id, et quelques lignes de progression (70/30/100% sur les 3 premières). Utiliser `argon2.hash`.
- [ ] **Step 2: Exécuter** (nécessite Postgres up — voir M9 docker, ou Postgres local). Run `npm run db:seed`. Expected: « seed ok ».
- [ ] **Step 3: Commit.** `git commit -am "feat: seed dev (magasin Lille, formations, comptes)"`

---

## M3 — Logique métier (pure, testée d'abord)

### Task 3.1: Calculs bascule (J-N, %)

**Files:**
- Create: `src/lib/bascule.ts`, `tests/lib/bascule.test.ts`

- [ ] **Step 1: Écrire les tests.**

```ts
import { joursRestants, parcoursPercent } from '@/lib/bascule'
import { expect, test } from 'vitest'

test('joursRestants = différence en jours pleins', () => {
  const today = new Date('2026-06-04T10:00:00Z')
  expect(joursRestants('2026-06-22', today)).toBe(18)
})
test('joursRestants jamais négatif (jour J ou passé → 0)', () => {
  const today = new Date('2026-06-25T10:00:00Z')
  expect(joursRestants('2026-06-22', today)).toBe(0)
})
test('parcoursPercent = currentStep / 4', () => {
  expect(parcoursPercent(0)).toBe(0)
  expect(parcoursPercent(1)).toBe(25)
  expect(parcoursPercent(4)).toBe(100)
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implémenter.**

```ts
export function joursRestants(basculeDate: string, now = new Date()): number {
  const target = new Date(basculeDate + 'T00:00:00Z')
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const diff = Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
  return Math.max(0, diff)
}
export function parcoursPercent(currentStep: number): number {
  return Math.round((Math.min(4, Math.max(0, currentStep)) / 4) * 100)
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat: calculs bascule J-N et %"`

### Task 3.2: Agrégat progression formations

**Files:**
- Create: `src/lib/progress.ts`, `tests/lib/progress.test.ts`

- [ ] **Step 1: Écrire les tests** : `summarize(rows, total)` → `{ done, total, percentByFormation }`.

```ts
import { summarizeProgress } from '@/lib/progress'
import { expect, test } from 'vitest'
test('compte les formations terminées', () => {
  const rows = [
    { formationId: 'a', status: 'done', progressPercent: 100 },
    { formationId: 'b', status: 'in_progress', progressPercent: 30 },
    { formationId: 'c', status: 'done', progressPercent: 100 },
  ] as const
  const s = summarizeProgress(rows, 8)
  expect(s.done).toBe(2)
  expect(s.total).toBe(8)
  expect(s.percentByFormation.b).toBe(30)
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implémenter** `summarizeProgress`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat: agrégat progression formations"`

---

## M4 — Auth (Auth.js + middleware)

### Task 4.1: Helpers mot de passe

**Files:**
- Create: `src/server/auth/password.ts`, `tests/server/password.test.ts`

- [ ] **Step 1: Test** : `hashPassword` puis `verifyPassword` round-trip vrai, mauvais mdp faux.

```ts
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { expect, test } from 'vitest'
test('hash + verify round-trip', async () => {
  const h = await hashPassword('s3cret!')
  expect(await verifyPassword(h, 's3cret!')).toBe(true)
  expect(await verifyPassword(h, 'wrong')).toBe(false)
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implémenter** avec `argon2` (`argon2.hash` / `argon2.verify`, type `argon2id`).
- [ ] **Step 4: Run** → PASS (peut être lent, ok).
- [ ] **Step 5: Commit.** `git commit -am "feat: hash/verify mot de passe argon2id"`

### Task 4.2: Config Auth.js credentials

**Files:**
- Create: `src/server/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Écrire `auth.ts`** : `NextAuth` v5, provider `Credentials` (email + password) → cherche le user par email, `verifyPassword`, retourne `{ id, email, firstName, role, storeId }`. `session.strategy = 'jwt'`. Callbacks `jwt` (injecte `role`, `storeId`, `firstName`) et `session` (les expose sur `session.user`). `pages.signIn = '/connexion'`. Exporter `auth`, `signIn`, `signOut`, `handlers`.
- [ ] **Step 2: Route handler** `route.ts` réexporte `handlers.GET/POST`.
- [ ] **Step 3: Types** : augmenter `next-auth` (`Session.user.role`, `.storeId`, `.firstName`) dans `src/types/next-auth.d.ts`.
- [ ] **Step 4: Build check.** Run `npm run build`. Expected: OK.
- [ ] **Step 5: Commit.** `git commit -am "feat: Auth.js credentials + JWT role/store"`

### Task 4.3: Middleware de protection

**Files:**
- Create: `src/middleware.ts`, `tests/lib/access.test.ts`
- Create: `src/lib/access.ts` (logique pure testable)

- [ ] **Step 1: Test** de la logique d'accès pure `decideAccess({ path, isLoggedIn, role })` → `'allow' | 'redirect-login' | 'redirect-home'`.

```ts
import { decideAccess } from '@/lib/access'
import { expect, test } from 'vitest'
test('non connecté hors /connexion → login', () => {
  expect(decideAccess({ path: '/', isLoggedIn: false, role: null })).toBe('redirect-login')
})
test('/connexion public', () => {
  expect(decideAccess({ path: '/connexion', isLoggedIn: false, role: null })).toBe('allow')
})
test('employé sur /admin → home', () => {
  expect(decideAccess({ path: '/admin/magasins', isLoggedIn: true, role: 'employee' })).toBe('redirect-home')
})
test('admin sur /admin → allow', () => {
  expect(decideAccess({ path: '/admin/magasins', isLoggedIn: true, role: 'admin' })).toBe('allow')
})
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implémenter** `decideAccess`. **Step 4: Run** → PASS.
- [ ] **Step 5: Écrire `middleware.ts`** : utilise `auth()` (Auth.js) pour `isLoggedIn`/`role`, applique `decideAccess`, redirige. `matcher` exclut `/api`, `/_next`, assets statiques.
- [ ] **Step 6: Commit.** `git commit -am "feat: middleware protection routes + tests access"`

---

## M5 — tRPC

### Task 5.1: Init tRPC + procedures

**Files:**
- Create: `src/server/trpc/trpc.ts`, `src/server/trpc/root.ts`, `src/app/api/trpc/[trpc]/route.ts`, `src/lib/trpc/client.tsx`

- [ ] **Step 1: `trpc.ts`** : `initTRPC.context<Context>()` (context = `{ session, db }`), `superjson`. `publicProcedure`, `protectedProcedure` (throw `UNAUTHORIZED` si pas de session), `adminProcedure` (throw `FORBIDDEN` si `role!=='admin'`).
- [ ] **Step 2: `root.ts`** : `appRouter` assemblant les routers (store, formation, progress, brain, admin — créés ensuite). Exporter `AppRouter`.
- [ ] **Step 3: Route handler** `fetchRequestHandler` ; context construit via `auth()` + `db`.
- [ ] **Step 4: Client React** (`client.tsx`) : provider react-query + trpc, `httpBatchLink` vers `/api/trpc`, `superjson`.
- [ ] **Step 5: Build check.** Run `npm run build`. Expected: OK.
- [ ] **Step 6: Commit.** `git commit -am "feat: init tRPC (public/protected/admin procedures)"`

### Task 5.2: Routers store/formation/progress

**Files:**
- Create: `src/server/trpc/routers/store.ts`, `formation.ts`, `progress.ts`

- [ ] **Step 1: `store.ts`** : `getMine` (protected) → magasin de l'utilisateur + `joursRestants` + `parcoursPercent` + `currentStep`/libellé étape.
- [ ] **Step 2: `formation.ts`** : `list` (protected) → toutes les formations triées `order` ; `bySlug` (protected) → formation + `formationDocuments` + `related`.
- [ ] **Step 3: `progress.ts`** : `mine` (protected) → lignes de progression de l'utilisateur + `summarizeProgress` ; `markDone(formationId)` (protected) → upsert `status=done, 100%`.
- [ ] **Step 4: Tests** (avec DB de test ou mocks du `db`) : au minimum un test que `store.getMine` calcule bien `joursRestants` à partir d'un magasin mocké. Si pas de DB de test branchée, tester la fonction de mapping extraite dans `lib/`.
- [ ] **Step 5: Commit.** `git commit -am "feat: routers tRPC store/formation/progress"`

---

## M6 — BRAIN ↔ Dify

### Task 6.1: Parsing du stream Dify (pur, testé)

**Files:**
- Create: `src/server/dify/parse.ts`, `tests/server/dify-parse.test.ts`

- [ ] **Step 1: Écrire les tests** d'un parseur d'events SSE Dify → `{ answerDelta?, sources?, conversationId? }`.

```ts
import { parseDifyEvent, mapSources } from '@/server/dify/parse'
import { expect, test } from 'vitest'

test('event message → delta de texte', () => {
  const e = parseDifyEvent(JSON.stringify({ event: 'message', answer: 'Bonjour', conversation_id: 'c1' }))
  expect(e.answerDelta).toBe('Bonjour')
  expect(e.conversationId).toBe('c1')
})
test('message_end → sources mappées depuis retriever_resources', () => {
  const e = parseDifyEvent(JSON.stringify({
    event: 'message_end',
    metadata: { retriever_resources: [
      { document_name: 'Guide Encaissement v2.pdf', position: 14, dataset_name: 'Encaissement' },
    ] },
  }))
  expect(e.sources?.[0]).toEqual({ doc: 'Guide Encaissement v2.pdf', page: 'p. 14', tag: 'Encaissement' })
})
test('mapSources tolère champs manquants', () => {
  expect(mapSources([{ document_name: 'X.pdf' }])[0]).toMatchObject({ doc: 'X.pdf' })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implémenter** `parseDifyEvent` (JSON.parse tolérant, switch sur `event`) et `mapSources` (`document_name→doc`, `position→"p. N"`, `dataset_name||tag→tag`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat: parseur stream Dify + mapping sources"`

### Task 6.2: Client Dify + route proxy streaming

**Files:**
- Create: `src/server/dify/client.ts`, `src/app/api/brain/route.ts`

- [ ] **Step 1: `client.ts`** : `streamChat({ query, user, conversationId })` → `fetch` `POST {DIFY_API_URL}/v1/chat-messages` (`response_mode:'streaming'`, header Bearer `DIFY_API_KEY`), retourne le `ReadableStream` de la réponse.
- [ ] **Step 2: `route.ts`** (`POST`, runtime nodejs) : auth obligatoire (`auth()`), lit `{ query }`, récupère `difyConversationId` du user, appelle `streamChat`, **relaie le SSE** au client en re-streamant ; à la fin, persiste le `conversation_id` retourné si le user n'en avait pas. Gère erreur Dify → 502 JSON.
- [ ] **Step 3: Test** (mock `streamChat`) que la route refuse un non-connecté (401). 
- [ ] **Step 4: Commit.** `git commit -am "feat: route /api/brain proxy streaming Dify"`

---

## M7 — Écrans (portage hifi depuis la référence)

> Pour chaque écran : porter le JSX de `docs/handoff/directions/dirB.jsx` en composants React/Tailwind, en remplaçant les styles inline par les tokens (`src/lib/design/tokens.ts` / classes Tailwind), `Icon` maison → `Icon` Lucide, données mock → données tRPC. Conserver tailles/espacements/rayons du README au pixel.

### Task 7.1: Écran Connexion (`/connexion`)

**Files:**
- Create: `src/app/(auth)/connexion/page.tsx`, `src/components/auth/LoginForm.tsx`

- [ ] **Step 1: Porter `LoginB`** (dirB.jsx 77–131) : 2 colonnes (54% marque + `BRoute current={1}`, 46% formulaire 350px). Logo APS, champs `Identifiant`/`Mot de passe` avec icônes `user`/`lock`, bouton rouge « Embarquer → ».
- [ ] **Step 2: Câbler le form** : `LoginForm` client → `signIn('credentials', { email, password, redirect })`. Afficher l'état d'erreur (« Identifiant ou mot de passe invalide »). Succès → `/`.
- [ ] **Step 3: Test composant** : champs présents, bouton « Embarquer » présent, message d'erreur rendu quand `error` set.
- [ ] **Step 4: Commit.** `git commit -am "feat: écran Connexion + auth credentials"`

### Task 7.2: Layout connecté (BNav + transition)

**Files:**
- Create: `src/app/(app)/layout.tsx`, `src/components/nav/BNav.tsx`

- [ ] **Step 1: Porter `BNav`** (dirB.jsx 21–49) : logo Cockpit, liens Accueil/Formations/BRAIN/Actualités (Next `Link`, `active` selon pathname), search/bell, avatar initiales (depuis session `firstName`), `ApsLogo`. « Actualités » = lien présent, page phase 2 (placeholder « Bientôt »).
- [ ] **Step 2: Layout** : `BNav` + `<main>` avec transition fondu/translateY (clé = pathname).
- [ ] **Step 3: Test** : liens de nav rendus, lien actif marqué.
- [ ] **Step 4: Commit.** `git commit -am "feat: layout connecté + BNav"`

### Task 7.3: Accueil (`/`)

**Files:**
- Create: `src/app/(app)/page.tsx`, `src/components/home/*`

- [ ] **Step 1: Porter `HomeB`** (dirB.jsx 134–200) : en-tête (sur-titre magasin, « Bonjour {firstName}, plus que {N} jours », étape courante), carte parcours (`BRoute`), 2 cartes d'accès (Formation / BRAIN sombre), bande « À reprendre » (3 cartes + barres).
- [ ] **Step 2: Données réelles** : server component appelle `store.getMine` + `progress.mine` (ou via RSC `createCaller`). Le `firstName`, `joursRestants`, `currentStep`, et les barres viennent de la DB. Liens vers `/formations`, `/brain`, `/formations/[slug]`.
- [ ] **Step 3: Test** : rend « Bonjour Camille » et « 18 jours » avec données mockées.
- [ ] **Step 4: Commit.** `git commit -am "feat: écran Accueil (données réelles)"`

### Task 7.4: Espace Formation (`/formations`)

**Files:**
- Create: `src/app/(app)/formations/page.tsx`, `src/components/formations/FormationCard.tsx`

- [ ] **Step 1: Porter `FormB`** (dirB.jsx 203–236) : titre + paragraphe, grille 4 colonnes de cartes. Carte = numéro index serif, pastille icône, nom/desc, CTA `Télécharger le PDF` (kind=pdf) ou `Ouvrir dans SharePoint` (kind=sharepoint).
- [ ] **Step 2: Données** : `formation.list`. Carte `pdf` → `Link` vers `/formations/[slug]` ; carte `sharepoint` → `<a href={sharepointUrl} target=_blank>`.
- [ ] **Step 3: Test** : 8 cartes rendues, CTA correct selon `kind`.
- [ ] **Step 4: Commit.** `git commit -am "feat: écran Espace Formation"`

### Task 7.5: Détail formation (`/formations/[slug]`)

**Files:**
- Create: `src/app/(app)/formations/[slug]/page.tsx`, `src/components/formations/*`

- [ ] **Step 1: Porter `FormDetailB`** (dirB.jsx 345–414) : 2 colonnes (1.7fr/1fr). Gauche : fil d'Ariane, tag, titre, chapô, méta, liste documents (numéro, titre, badge NOUVEAU, méta, lien Télécharger). Droite : `ImgSlot` couverture, carte Progression (% + barre + lien SharePoint), carte « Pour aller plus loin » (related).
- [ ] **Step 2: Données** : `formation.bySlug`. Si pas de documents (kind=sharepoint pur en V1) → afficher état « Documents bientôt disponibles » + bouton SharePoint. `notFound()` si slug inconnu.
- [ ] **Step 3: Test** : rend titre formation + N documents.
- [ ] **Step 4: Commit.** `git commit -am "feat: écran Détail formation"`

### Task 7.6: BRAIN (`/brain`)

**Files:**
- Create: `src/app/(app)/brain/page.tsx`, `src/components/brain/{Conversation,Message,SourceList,Suggestions,BrainInput}.tsx`, `src/lib/brain/useBrainChat.ts`, `src/lib/brain/suggestions.ts`

- [ ] **Step 1: Porter `BrainB`** (dirB.jsx 239–294) : en-tête pastille rouge + titre, bulle user sombre alignée droite, réponse IA serif + sources stylées (pastilles rondes rouges, icône fichier, doc/tag/page), libellé SUGGESTIONS + chips, champ de saisie + bouton envoi rouge. Garde-fou texte sous l'input.
- [ ] **Step 2: `suggestions.ts`** = constante (les 4 questions de `shared.jsx` `BRAIN_SUGGEST`).
- [ ] **Step 3: `useBrainChat`** (client) : envoie la question à `/api/brain`, lit le stream (`response.body.getReader()`), accumule le texte via `parseDifyEvent` (réutilisé côté client) et met à jour `sources` à `message_end`. Gère états `idle/streaming/error`.
- [ ] **Step 4: Test** du hook avec un `ReadableStream` mocké de 2 events (message + message_end) → texte concaténé + 1 source. (Tester la réduction d'events, pas le fetch réseau.)
- [ ] **Step 5: Commit.** `git commit -am "feat: écran BRAIN + chat streaming Dify"`

### Task 7.7: Mobile / responsive

**Files:**
- Modify: écrans + `BNav` ; Create: `src/components/nav/MobileTabBar.tsx`

- [ ] **Step 1: Porter la barre d'onglets basse** (`HomeBMobile` 332–339) : fixe en bas en `<md`, onglets Accueil/Former/BRAIN/Profil. `BNav` masqué `<md`, barre marque mobile affichée.
- [ ] **Step 2: Rendre responsive** : grilles formations 4→2→1 col, détail 2→1 col, accueil cartes empilées, titres réduits. Utiliser les breakpoints Tailwind.
- [ ] **Step 3: Vérif manuelle** (build + revue rapide). 
- [ ] **Step 4: Commit.** `git commit -am "feat: responsive mobile + tab bar"`

---

## M8 — Admin

### Task 8.1: Router admin

**Files:**
- Create: `src/server/trpc/routers/admin.ts`

- [ ] **Step 1: Implémenter** (toutes `adminProcedure`) :
  - `stores.list` / `stores.update({ id, name?, basculeDate?, currentStep? })`.
  - `formations.list` / `formations.create(...)` / `formations.update(...)` / `formations.delete(id)`.
  - `users.list` / `users.create({ email, firstName, password, role, storeId })` (hash argon2) / `users.update(...)`.
- [ ] **Step 2: Tests** : `currentStep` borné 0–4 (zod `.min(0).max(4)`) ; `users.create` hashe le mot de passe (vérifier qu'on ne stocke pas le clair — tester la fonction de préparation extraite).
- [ ] **Step 3: Commit.** `git commit -am "feat: router admin (stores/formations/users)"`

### Task 8.2: Layout admin + garde rôle

**Files:**
- Create: `src/app/admin/layout.tsx`, `src/components/admin/AdminNav.tsx`

- [ ] **Step 1: Layout** : vérifie `session.user.role==='admin'` (sinon `redirect('/')`), nav latérale (Magasins / Formations / Utilisateurs).
- [ ] **Step 2: Commit.** `git commit -am "feat: layout admin + garde rôle"`

### Task 8.3: Pages admin (magasins, formations, utilisateurs)

**Files:**
- Create: `src/app/admin/magasins/page.tsx`, `admin/formations/page.tsx`, `admin/utilisateurs/page.tsx` + composants table/forms

- [ ] **Step 1: Magasins** : table + édition inline (`basculeDate` date input, `currentStep` select 0–4) → `admin.stores.update`.
- [ ] **Step 2: Formations** : table + formulaire create/update (name, slug, tag, icon, description, kind, sharepointUrl, docCount, order) + delete confirmé.
- [ ] **Step 3: Utilisateurs** : table + formulaire create (email, firstName, password, role, storeId) → `admin.users.create`.
- [ ] **Step 4: Test** : un composant form admin rend et soumet (mock mutation).
- [ ] **Step 5: Commit.** `git commit -am "feat: pages admin magasins/formations/utilisateurs"`

---

## M9 — Déploiement Dokploy + Traefik

### Task 9.1: Dockerfile standalone

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `next.config.ts` (`output: 'standalone'`)

- [ ] **Step 1: `output: 'standalone'`** dans `next.config.ts`.
- [ ] **Step 2: Dockerfile multi-stage** (deps → build → runner). Runner : `node:24-alpine`, copie `.next/standalone`, `.next/static`, `public`. `ENV HOSTNAME=0.0.0.0 PORT=3000`. `CMD ["node","server.js"]`. Healthcheck `wget -qO- http://127.0.0.1:3000/api/health || exit 1` (IPv4).
- [ ] **Step 3: `/api/health`** route → `200 {ok:true}`.
- [ ] **Step 4: `.dockerignore`** (node_modules, .next, .git, docs).
- [ ] **Step 5: Build image local.** Run `docker build -t formaps .`. Expected: image construite.
- [ ] **Step 6: Commit.** `git commit -am "feat: Dockerfile standalone + healthcheck"`

### Task 9.2: docker-compose (app + Postgres) pour Dokploy

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Service `db`** : `postgres:16-alpine`, volume nommé persistant, `POSTGRES_*` depuis env, healthcheck `pg_isready`.
- [ ] **Step 2: Service `web`** : build, `depends_on: db (healthy)`, env `DATABASE_URL` (pointe `db`), `AUTH_SECRET`, `DIFY_API_URL`, `DIFY_API_KEY`, `HOSTNAME=0.0.0.0`. Labels Traefik (router + service + `entrypoints=websecure` + certresolver) cohérents avec le domaine déclaré dans l'UI Dokploy. Rattacher au réseau Traefik **et** à un réseau interne partagé avec le container Dify.
- [ ] **Step 3: Migrations au boot** : commande de démarrage `npm run db:migrate && node server.js` (ou un entrypoint script), pour appliquer le schéma en prod.
- [ ] **Step 4: Commit.** `git commit -am "feat: docker-compose app + postgres (Dokploy/Traefik)"`

### Task 9.3: Doc déploiement + README projet

**Files:**
- Create: `README.md`, `docs/DEPLOY.md`

- [ ] **Step 1: README** : présentation, stack, dev local (`.env`, `db:migrate`, `db:seed`, `dev`), tests.
- [ ] **Step 2: `DEPLOY.md`** : étapes Dokploy (créer app depuis le repo, variables d'env, déclarer le domaine dans l'UI **et** vérifier les labels, brancher le réseau Dify, vérifier container **healthy** avant tout debug Traefik, auto-deploy au merge).
- [ ] **Step 3: Commit + push.** `git push -u origin main`.

---

## Self-Review (couverture spec)

- §2 stack → M0, M5, M4, M6 ✓
- §3 routes → M5 (api), M7 (écrans), M4 (middleware) ✓
- §4 modèle données → M2 (Task 2.1) ✓
- §5 BRAIN↔Dify → M6 (6.1 parsing, 6.2 proxy) + 7.6 (UI) ✓
- §6 auth → M4 ✓
- §7 admin → M8 ✓
- §8 déploiement → M9 ✓
- §9 fidélité/responsive → M1 (tokens/primitives) + M7 (écrans + mobile) ✓
- §10 tests → tests TDD dans chaque tâche logique (bascule, progress, password, access, dify-parse, useBrainChat) ✓
- §11 phases → V1 = M0–M9 ; `formation_documents`/reset mdp/suggestions DB = phase 2 (table créée, UI détail gère l'absence de docs) ✓

**Note d'exécution :** Postgres est requis dès M2 (seed) et M5/M8 (routers DB). Si pas de Postgres local, lancer le service `db` du compose (Task 9.2) tôt, ou un `docker run postgres` ponctuel. Les suites de tests >150 cas peuvent faire timeout un subagent : committer avant de lancer la suite complète.
