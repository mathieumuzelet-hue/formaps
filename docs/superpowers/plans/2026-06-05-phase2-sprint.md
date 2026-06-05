# Phase 2 Sprint Implementation Plan — markDone UI, suggestions BRAIN, reset mdp

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer les 3 chantiers Phase 2 du spec `docs/superpowers/specs/2026-06-05-phase2-sprint-design.md` : bouton « Marquer comme terminée » (annulable), suggestions BRAIN pilotées en base avec fallback, reset mot de passe par admin + changement self-service.

**Architecture:** Next.js 16 App Router. Pages `(app)` = Server Components alimentés par `getServerCaller()` ; mutations côté client via `trpc` (`@/lib/trpc/client`) dans des composants `'use client'` ciblés. Logique testable extraite en modules purs server-free (pattern existant). Nouvelle table `brain_suggestions` via drizzle-kit.

**Tech Stack:** Next.js 16.2.7, tRPC v11, Drizzle ORM + postgres.js, Auth.js v5 (next-auth@beta), argon2id, Tailwind 4, Vitest + Testing Library.

**Ordre d'exécution :** Lot 2 (Tasks 1–3) → Lot 3 (Tasks 4–9) → Lot 1 (Tasks 10–14) → Task 15 (vérification finale).

**Conventions du repo (à respecter dans chaque task) :**
- Lire `node_modules/next/dist/docs/` en cas de doute sur une API Next 16 (exigence AGENTS.md).
- Commandes depuis `C:\Users\mathi\formaps` (PowerShell). Tests : `npx vitest run <fichier>` ; suite : `npm test` ; lint : `npm run lint` ; types : `npx tsc --noEmit`.
- Ne JAMAIS sélectionner/retourner `passwordHash` vers le client.
- Messages d'UI en français ; code/commits en anglais.

---

## File Structure (vue d'ensemble)

```
Créés :
  src/components/formation/MarkDoneButton.tsx        (Lot 2 — client component)
  tests/components/MarkDoneButton.test.tsx
  src/server/trpc/routers/brain.ts                   (Lot 3 — lecture employé)
  src/components/admin/SuggestionsAdmin.tsx          (Lot 3 — CRUD admin)
  src/app/admin/suggestions/page.tsx
  tests/lib/brain-suggestions.test.ts
  tests/lib/suggestion-schemas.test.ts
  src/lib/account/schemas.ts                         (Lot 1 — zod server-free)
  src/server/trpc/routers/account.ts
  src/components/account/ChangePasswordForm.tsx
  src/app/(app)/compte/mot-de-passe/page.tsx
  tests/lib/account-schemas.test.ts
  tests/components/ChangePasswordForm.test.tsx
  drizzle/0002_<auto>.sql                            (migration générée)

Modifiés :
  src/server/trpc/routers/progress.ts                (+ markUndone)
  src/app/(app)/formations/[slug]/page.tsx           (intègre MarkDoneButton)
  src/server/db/schema.ts                            (+ brainSuggestions)
  src/lib/admin/schemas.ts                           (+ suggestion*Schema)
  src/server/trpc/routers/admin.ts                   (+ brainSuggestionsRouter, + users.resetPassword)
  src/server/trpc/root.ts                            (+ brain, + account)
  src/lib/brain/suggestions.ts                       (+ resolveSuggestions)
  src/components/brain/BrainChat.tsx                 (suggestions en prop)
  src/app/(app)/brain/page.tsx                       (RSC async, fetch suggestions)
  src/components/admin/AdminNav.tsx                  (+ lien Suggestions)
  src/components/admin/UtilisateursAdmin.tsx         (+ bouton reset + encart mdp)
  src/components/nav/BNav.tsx                        (avatar → lien /compte/mot-de-passe)
```

---

# LOT 2 — Bouton « Marquer comme terminée »

### Task 1: Mutation `progress.markUndone`

Les routers tRPC ne sont pas testés unitairement dans ce repo (pattern établi : seule la logique extraite est testée ; `markUndone` est un delete trivial sans logique extractible). Validation : `tsc` + lint + tests composant de la Task 2.

**Files:**
- Modify: `src/server/trpc/routers/progress.ts`

- [ ] **Step 1: Ajouter la mutation**

Dans `src/server/trpc/routers/progress.ts`, ajouter l'import `and` à la ligne 1 :

```ts
import { and, count, eq } from 'drizzle-orm'
```

Puis ajouter après `markDone` (avant la fermeture du `router({...})`) :

```ts
  /**
   * Revert a formation to "not started" for the current user by deleting the
   * progress row. Idempotent: succeeds even when no row exists.
   */
  markUndone: protectedProcedure
    .input(z.object({ formationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(userFormationProgress)
        .where(
          and(
            eq(userFormationProgress.userId, ctx.user.id),
            eq(userFormationProgress.formationId, input.formationId),
          ),
        )

      return { formationId: input.formationId }
    }),
```

- [ ] **Step 2: Vérifier types + lint**

Run: `npx tsc --noEmit; npm run lint`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```powershell
git add src/server/trpc/routers/progress.ts
git commit -m "feat(progress): markUndone mutation reverts a formation to not started"
```

---

### Task 2: Composant `MarkDoneButton` (TDD)

**Files:**
- Create: `src/components/formation/MarkDoneButton.tsx`
- Test: `tests/components/MarkDoneButton.test.tsx`

- [ ] **Step 1: Vérifier le nom d'icône check**

Run: `Select-String -Path src/components/ui/Icon.tsx -Pattern "check" | Select-Object -First 5`
Expected: un nom d'icône `check` (utilisé par `BRoute.tsx` pour les étapes faites). S'il s'appelle autrement (ex. `checkCircle`), utiliser CE nom dans le Step 3.

- [ ] **Step 2: Écrire le test qui échoue**

Créer `tests/components/MarkDoneButton.test.tsx` :

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { MarkDoneButton } from '@/components/formation/MarkDoneButton'

const { markDoneMutate, markUndoneMutate } = vi.hoisted(() => ({
  markDoneMutate: vi.fn(),
  markUndoneMutate: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    progress: {
      markDone: {
        useMutation: () => ({ mutate: markDoneMutate, isPending: false, isError: false }),
      },
      markUndone: {
        useMutation: () => ({ mutate: markUndoneMutate, isPending: false, isError: false }),
      },
    },
  },
}))

const FORMATION_ID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'

beforeEach(() => {
  markDoneMutate.mockClear()
  markUndoneMutate.mockClear()
})

test('percent < 100 : bouton "Marquer comme terminée" appelle markDone', () => {
  render(<MarkDoneButton formationId={FORMATION_ID} percent={40} />)
  const btn = screen.getByRole('button', { name: /marquer comme terminée/i })
  fireEvent.click(btn)
  expect(markDoneMutate).toHaveBeenCalledWith({ formationId: FORMATION_ID })
})

test('percent = 100 : badge terminé + lien d\'annulation appelle markUndone', () => {
  render(<MarkDoneButton formationId={FORMATION_ID} percent={100} />)
  expect(screen.getByText(/formation terminée/i)).toBeInTheDocument()
  const undo = screen.getByRole('button', { name: /marquer comme non terminée/i })
  fireEvent.click(undo)
  expect(markUndoneMutate).toHaveBeenCalledWith({ formationId: FORMATION_ID })
})

test('percent = 100 : le bouton "Marquer comme terminée" n\'est pas affiché', () => {
  render(<MarkDoneButton formationId={FORMATION_ID} percent={100} />)
  expect(
    screen.queryByRole('button', { name: /^marquer comme terminée$/i }),
  ).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Vérifier que le test échoue**

Run: `npx vitest run tests/components/MarkDoneButton.test.tsx`
Expected: FAIL — `Cannot find module '@/components/formation/MarkDoneButton'`.

- [ ] **Step 4: Implémenter le composant**

Créer `src/components/formation/MarkDoneButton.tsx` :

```tsx
'use client'

import { useRouter } from 'next/navigation'

import { trpc } from '@/lib/trpc/client'
import { Icon } from '@/components/ui/Icon'

/**
 * Toggle de progression d'une formation pour l'utilisateur courant.
 * < 100 % : bouton « Marquer comme terminée » (progress.markDone).
 * 100 % : badge terminé + lien discret d'annulation (progress.markUndone).
 * Les données venant du RSC parent, on rafraîchit la route en succès.
 */
export function MarkDoneButton({
  formationId,
  percent,
}: {
  formationId: string
  percent: number
}) {
  const router = useRouter()
  const markDone = trpc.progress.markDone.useMutation({
    onSuccess: () => router.refresh(),
  })
  const markUndone = trpc.progress.markUndone.useMutation({
    onSuccess: () => router.refresh(),
  })
  const pending = markDone.isPending || markUndone.isPending

  if (percent >= 100) {
    return (
      <div className="mt-4 border-t border-line pt-[14px]">
        <div className="flex items-center gap-2 text-[13px] font-bold text-ink">
          <Icon name="check" size={16} color="#A20D24" />
          Formation terminée
        </div>
        <button
          type="button"
          onClick={() => markUndone.mutate({ formationId })}
          disabled={pending}
          className="mt-2 text-[12.5px] font-medium text-sub underline underline-offset-2 disabled:opacity-50"
        >
          Marquer comme non terminée
        </button>
        {markUndone.isError && (
          <p className="mt-2 text-[12.5px] text-red">{markUndone.error.message}</p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-4 border-t border-line pt-[14px]">
      <button
        type="button"
        onClick={() => markDone.mutate({ formationId })}
        disabled={pending}
        className="w-full rounded-[10px] bg-red px-4 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-50"
      >
        {pending ? 'Enregistrement…' : 'Marquer comme terminée'}
      </button>
      {markDone.isError && (
        <p className="mt-2 text-[12.5px] text-red">{markDone.error.message}</p>
      )}
    </div>
  )
}
```

(Si le Step 1 a révélé un autre nom d'icône, l'utiliser ici à la place de `check`.)

- [ ] **Step 5: Vérifier que les tests passent**

Run: `npx vitest run tests/components/MarkDoneButton.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```powershell
git add src/components/formation/MarkDoneButton.tsx tests/components/MarkDoneButton.test.tsx
git commit -m "feat(formation): MarkDoneButton client component with undo"
```

---

### Task 3: Intégrer le bouton dans la carte PROGRESSION

**Files:**
- Modify: `src/app/(app)/formations/[slug]/page.tsx` (carte « Progression », lignes ~133-162)

- [ ] **Step 1: Brancher le composant**

Dans `src/app/(app)/formations/[slug]/page.tsx`, ajouter l'import en tête (après les imports existants) :

```tsx
import { MarkDoneButton } from '@/components/formation/MarkDoneButton'
```

Dans la carte « Progression card », insérer `<MarkDoneButton formationId={formation.id} percent={percent} />` juste APRÈS le bloc SharePoint (le ternaire `formation.sharepointUrl ? <a…> : <div…>`), à l'intérieur de la div `rounded-[16px] border border-line bg-surface…` :

```tsx
          {formation.sharepointUrl ? (
            <a
              href={formation.sharepointUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center gap-[9px] border-t border-line pt-[14px] text-[13px] font-bold text-sub"
            >
              <Icon name="external" size={16} color="#8A7F6E" /> Ouvrir sur
              SharePoint
            </a>
          ) : (
            <div className="mt-4 flex items-center gap-[9px] border-t border-line pt-[14px] text-[13px] font-bold text-sub">
              <Icon name="external" size={16} color="#8A7F6E" /> Ouvrir sur
              SharePoint
            </div>
          )}
          <MarkDoneButton formationId={formation.id} percent={percent} />
        </div>
```

- [ ] **Step 2: Vérifier types + lint + suite complète**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: 0 erreur, tous les tests verts.

- [ ] **Step 3: Commit**

```powershell
git add "src/app/(app)/formations/[slug]/page.tsx"
git commit -m "feat(formation): wire MarkDoneButton into the progression card"
```

---

# LOT 3 — Suggestions BRAIN en base

### Task 4: Table `brain_suggestions` + migration

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `drizzle/0002_<nom-auto>.sql` (généré)

- [ ] **Step 1: Ajouter la table au schéma**

Dans `src/server/db/schema.ts`, ajouter à la fin du fichier :

```ts
export const brainSuggestions = pgTable('brain_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  text: text('text').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

(Tous les helpers — `pgTable`, `uuid`, `text`, `integer`, `boolean`, `timestamp` — sont déjà importés ligne 1.)

- [ ] **Step 2: Générer la migration**

Run: `npm run db:generate`
Expected: un nouveau fichier `drizzle/0002_*.sql` contenant `CREATE TABLE "brain_suggestions"`.

- [ ] **Step 3: Appliquer en local (le container `formaps_postgres` port 5433 doit tourner)**

Run: `docker start formaps_postgres; npm run db:migrate`
Expected: migration appliquée sans erreur. (Si `DATABASE_URL` manque : il est dans `.env` — drizzle-kit le charge via dotenv.)

- [ ] **Step 4: Vérifier types + commit**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

```powershell
git add src/server/db/schema.ts drizzle/
git commit -m "feat(db): brain_suggestions table"
```

---

### Task 5: Schemas zod suggestions (TDD)

**Files:**
- Modify: `src/lib/admin/schemas.ts`
- Test: `tests/lib/suggestion-schemas.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/lib/suggestion-schemas.test.ts` :

```ts
import { expect, test } from 'vitest'

import {
  suggestionCreateSchema,
  suggestionReorderSchema,
  suggestionUpdateSchema,
} from '@/lib/admin/schemas'

const UUID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'

test('create : texte requis, 1 à 200 caractères', () => {
  expect(suggestionCreateSchema.safeParse({ text: 'Comment ouvrir une caisse ?' }).success).toBe(true)
  expect(suggestionCreateSchema.safeParse({ text: '' }).success).toBe(false)
  expect(suggestionCreateSchema.safeParse({ text: 'x'.repeat(201) }).success).toBe(false)
})

test('update : id uuid requis, champs optionnels', () => {
  expect(suggestionUpdateSchema.safeParse({ id: UUID, isActive: false }).success).toBe(true)
  expect(suggestionUpdateSchema.safeParse({ id: UUID, text: 'Nouvelle question ?' }).success).toBe(true)
  expect(suggestionUpdateSchema.safeParse({ id: 'pas-un-uuid' }).success).toBe(false)
})

test('reorder : liste non vide d\'uuids', () => {
  expect(suggestionReorderSchema.safeParse({ ids: [UUID] }).success).toBe(true)
  expect(suggestionReorderSchema.safeParse({ ids: [] }).success).toBe(false)
  expect(suggestionReorderSchema.safeParse({ ids: ['nope'] }).success).toBe(false)
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `npx vitest run tests/lib/suggestion-schemas.test.ts`
Expected: FAIL — exports inexistants.

- [ ] **Step 3: Implémenter les schemas**

À la fin de `src/lib/admin/schemas.ts`, ajouter :

```ts
/** Input schema for `admin.brainSuggestions.create`. */
export const suggestionCreateSchema = z.object({
  text: z.string().min(1).max(200),
})

/** Input schema for `admin.brainSuggestions.update`. */
export const suggestionUpdateSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
})

/** Input schema for `admin.brainSuggestions.reorder` — full ordered id list. */
export const suggestionReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
})
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run tests/lib/suggestion-schemas.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/admin/schemas.ts tests/lib/suggestion-schemas.test.ts
git commit -m "feat(admin): zod schemas for brain suggestions CRUD"
```

---

### Task 6: Helper de fallback `resolveSuggestions` (TDD)

**Files:**
- Modify: `src/lib/brain/suggestions.ts`
- Test: `tests/lib/brain-suggestions.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/lib/brain-suggestions.test.ts` :

```ts
import { expect, test } from 'vitest'

import { BRAIN_SUGGESTIONS, resolveSuggestions } from '@/lib/brain/suggestions'

test('retourne les suggestions DB quand il y en a', () => {
  const fromDb = ['Question A ?', 'Question B ?']
  expect(resolveSuggestions(fromDb)).toEqual(fromDb)
})

test('liste vide → fallback sur les suggestions hardcodées', () => {
  expect(resolveSuggestions([])).toEqual(BRAIN_SUGGESTIONS)
  expect(BRAIN_SUGGESTIONS.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `npx vitest run tests/lib/brain-suggestions.test.ts`
Expected: FAIL — `resolveSuggestions` non exporté.

- [ ] **Step 3: Implémenter**

À la fin de `src/lib/brain/suggestions.ts`, ajouter :

```ts
/**
 * Suggestions effectivement affichées : celles configurées en base si
 * présentes, sinon le fallback hardcodé — la zone n'est jamais vide.
 */
export function resolveSuggestions(fromDb: string[]): string[] {
  return fromDb.length > 0 ? fromDb : BRAIN_SUGGESTIONS
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run tests/lib/brain-suggestions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/brain/suggestions.ts tests/lib/brain-suggestions.test.ts
git commit -m "feat(brain): resolveSuggestions fallback helper"
```

---

### Task 7: Sub-router `admin.brainSuggestions` + router lecture `brain`

Routers = wiring sans logique extractible (pattern repo : non testés unitairement). Validation : `tsc` + lint.

**Files:**
- Modify: `src/server/trpc/routers/admin.ts`
- Create: `src/server/trpc/routers/brain.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Sub-router admin**

Dans `src/server/trpc/routers/admin.ts` :

1. Ligne 4, ajouter `max` à l'import drizzle :
```ts
import { asc, desc, eq, like, max } from 'drizzle-orm'
```
2. Ligne 8, ajouter `brainSuggestions` à l'import du schéma :
```ts
import { brainSuggestions, formationDocuments, formations, news, stores, users } from '@/server/db/schema'
```
3. Dans le bloc d'import depuis `@/lib/admin/schemas`, ajouter :
```ts
  suggestionCreateSchema,
  suggestionReorderSchema,
  suggestionUpdateSchema,
```
4. Ajouter ce router avant `export const adminRouter` :

```ts
const brainSuggestionsRouter = router({
  /** All suggestions (active or not), ordered for the admin list. */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(brainSuggestions)
      .orderBy(asc(brainSuggestions.sortOrder), asc(brainSuggestions.createdAt))
  }),

  /** Create at the end of the list (sortOrder = max + 1). */
  create: adminProcedure.input(suggestionCreateSchema).mutation(async ({ ctx, input }) => {
    const [{ value: maxOrder }] = await ctx.db
      .select({ value: max(brainSuggestions.sortOrder) })
      .from(brainSuggestions)
    const [row] = await ctx.db
      .insert(brainSuggestions)
      .values({ text: input.text, sortOrder: (maxOrder ?? -1) + 1 })
      .returning()
    return row
  }),

  update: adminProcedure.input(suggestionUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, ...fields } = input
    const [row] = await ctx.db
      .update(brainSuggestions)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(brainSuggestions.id, id))
      .returning()
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Suggestion introuvable' })
    return row
  }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(brainSuggestions)
        .where(eq(brainSuggestions.id, input.id))
        .returning()
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Suggestion introuvable' })
      return { id: input.id }
    }),

  /** Persist a full ordering: sortOrder = index in the given id list. */
  reorder: adminProcedure.input(suggestionReorderSchema).mutation(async ({ ctx, input }) => {
    const now = new Date()
    await ctx.db.transaction(async (tx) => {
      for (const [i, id] of input.ids.entries()) {
        await tx
          .update(brainSuggestions)
          .set({ sortOrder: i, updatedAt: now })
          .where(eq(brainSuggestions.id, id))
      }
    })
    return { ok: true }
  }),
})
```

5. Monter dans `adminRouter` :

```ts
export const adminRouter = router({
  stores: storesRouter,
  formations: formationsRouter,
  users: usersRouter,
  news: newsRouter,
  brainSuggestions: brainSuggestionsRouter,
})
```

- [ ] **Step 2: Router lecture employé**

Créer `src/server/trpc/routers/brain.ts` :

```ts
import { asc, eq } from 'drizzle-orm'

import { brainSuggestions } from '@/server/db/schema'
import { protectedProcedure, router } from '../trpc'

/**
 * Reader-facing BRAIN router. Every logged-in employee can read the active
 * suggestion pills shown under the chat composer.
 */
export const brainRouter = router({
  /** Active suggestions, in display order. */
  suggestions: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: brainSuggestions.id, text: brainSuggestions.text })
      .from(brainSuggestions)
      .where(eq(brainSuggestions.isActive, true))
      .orderBy(asc(brainSuggestions.sortOrder), asc(brainSuggestions.createdAt))
  }),
})
```

- [ ] **Step 3: Monter dans le root router**

Dans `src/server/trpc/root.ts` :

```ts
import { router } from './trpc'
import { storeRouter } from './routers/store'
import { formationRouter } from './routers/formation'
import { progressRouter } from './routers/progress'
import { adminRouter } from './routers/admin'
import { newsRouter } from './routers/news'
import { brainRouter } from './routers/brain'

/**
 * Root tRPC router. The `admin` router (M8) is admin-only at the procedure
 * level (`adminProcedure`).
 */
export const appRouter = router({
  store: storeRouter,
  formation: formationRouter,
  progress: progressRouter,
  admin: adminRouter,
  news: newsRouter,
  brain: brainRouter,
})

export type AppRouter = typeof appRouter
```

- [ ] **Step 4: Vérifier types + lint**

Run: `npx tsc --noEmit; npm run lint`
Expected: 0 erreur.

- [ ] **Step 5: Commit**

```powershell
git add src/server/trpc/routers/admin.ts src/server/trpc/routers/brain.ts src/server/trpc/root.ts
git commit -m "feat(brain): admin CRUD router and reader suggestions query"
```

---

### Task 8: BrainChat reçoit les suggestions en props + page RSC

**Files:**
- Modify: `src/components/brain/BrainChat.tsx`
- Modify: `src/app/(app)/brain/page.tsx`

- [ ] **Step 1: Prop `suggestions` sur BrainChat**

Dans `src/components/brain/BrainChat.tsx` :

1. La signature du composant (ligne ~111) devient :

```tsx
export function BrainChat({
  suggestions = BRAIN_SUGGESTIONS,
}: {
  suggestions?: string[]
}) {
```

2. Dans le bloc Composer (ligne ~168), remplacer `{BRAIN_SUGGESTIONS.map((q) => (` par `{suggestions.map((q) => (`.
3. L'import `BRAIN_SUGGESTIONS` (ligne 8) reste — il sert de valeur par défaut.

- [ ] **Step 2: Page brain → RSC async**

Remplacer le contenu de `src/app/(app)/brain/page.tsx` par :

```tsx
import { BrainChat } from '@/components/brain/BrainChat'
import { resolveSuggestions } from '@/lib/brain/suggestions'
import { getServerCaller } from '@/server/trpc/server'

export default async function BrainPage() {
  const api = await getServerCaller()
  const rows = await api.brain.suggestions()
  return <BrainChat suggestions={resolveSuggestions(rows.map((r) => r.text))} />
}
```

- [ ] **Step 3: Vérifier types + lint + suite**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: 0 erreur, tous tests verts (les tests `useBrainChat` ne touchent pas aux suggestions).

- [ ] **Step 4: Commit**

```powershell
git add src/components/brain/BrainChat.tsx "src/app/(app)/brain/page.tsx"
git commit -m "feat(brain): chat suggestions driven by DB with hardcoded fallback"
```

---

### Task 9: UI admin `SuggestionsAdmin` + page + lien nav

**Files:**
- Create: `src/components/admin/SuggestionsAdmin.tsx`
- Create: `src/app/admin/suggestions/page.tsx`
- Modify: `src/components/admin/AdminNav.tsx`

- [ ] **Step 1: Composant CRUD**

Créer `src/components/admin/SuggestionsAdmin.tsx` (pattern `MagasinsAdmin`) :

```tsx
'use client'

import { useState } from 'react'

import { trpc } from '@/lib/trpc/client'

type Suggestion = {
  id: string
  text: string
  sortOrder: number
  isActive: boolean
}

const TH = 'px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint'
const TD = 'px-4 py-3 text-[14px] text-ink align-middle'
const INPUT =
  'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px] focus:border-ink focus:outline-none'

export function SuggestionsAdmin() {
  const list = trpc.admin.brainSuggestions.list.useQuery()
  const utils = trpc.useUtils()
  const [editing, setEditing] = useState<string | null>(null)

  const reorder = trpc.admin.brainSuggestions.reorder.useMutation({
    onSuccess: () => utils.admin.brainSuggestions.list.invalidate(),
  })
  const update = trpc.admin.brainSuggestions.update.useMutation({
    onSuccess: () => utils.admin.brainSuggestions.list.invalidate(),
  })
  const remove = trpc.admin.brainSuggestions.delete.useMutation({
    onSuccess: () => utils.admin.brainSuggestions.list.invalidate(),
  })

  if (list.isLoading) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }
  if (list.isError) {
    return <p className="mt-6 text-[14px] text-red">{list.error.message}</p>
  }

  const suggestions = (list.data ?? []) as Suggestion[]

  /** Swap with the neighbour and persist the full ordering. */
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= suggestions.length) return
    const ids = suggestions.map((s) => s.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorder.mutate({ ids })
  }

  return (
    <div className="mt-6 space-y-6">
      <SuggestionCreateForm />

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className={TH}>Ordre</th>
              <th className={TH}>Question</th>
              <th className={TH}>Active</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {suggestions.length === 0 && (
              <tr>
                <td className={`${TD} text-sub`} colSpan={4}>
                  Aucune suggestion — le chat affiche les questions par défaut.
                </td>
              </tr>
            )}
            {suggestions.map((s, i) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className={TD}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Monter"
                      disabled={i === 0 || reorder.isPending}
                      onClick={() => move(i, -1)}
                      className="rounded px-2 py-0.5 text-[13px] text-sub hover:bg-sand/50 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Descendre"
                      disabled={i === suggestions.length - 1 || reorder.isPending}
                      onClick={() => move(i, 1)}
                      className="rounded px-2 py-0.5 text-[13px] text-sub hover:bg-sand/50 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className={`${TD} w-full`}>
                  {editing === s.id ? (
                    <SuggestionEditField
                      suggestion={s}
                      onDone={() => setEditing(null)}
                    />
                  ) : (
                    s.text
                  )}
                </td>
                <td className={TD}>
                  <input
                    type="checkbox"
                    checked={s.isActive}
                    disabled={update.isPending}
                    onChange={() => update.mutate({ id: s.id, isActive: !s.isActive })}
                    aria-label={`Activer ${s.text}`}
                  />
                </td>
                <td className={`${TD} whitespace-nowrap text-right`}>
                  {editing !== s.id && (
                    <button
                      type="button"
                      onClick={() => setEditing(s.id)}
                      className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
                    >
                      Modifier
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm('Supprimer cette suggestion ?')) {
                        remove.mutate({ id: s.id })
                      }
                    }}
                    className="ml-2 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-red hover:bg-sand/50 disabled:opacity-50"
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(update.isError || remove.isError || reorder.isError) && (
        <p className="text-[13px] text-red">
          {update.error?.message ?? remove.error?.message ?? reorder.error?.message}
        </p>
      )}
    </div>
  )
}

function SuggestionCreateForm() {
  const utils = trpc.useUtils()
  const [text, setText] = useState('')

  const create = trpc.admin.brainSuggestions.create.useMutation({
    onSuccess: async () => {
      setText('')
      await utils.admin.brainSuggestions.list.invalidate()
    },
  })

  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <h2 className="text-[14px] font-semibold text-ink">Nouvelle suggestion</h2>
      <form
        className="mt-3 flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim() === '') return
          create.mutate({ text: text.trim() })
        }}
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            Question (max 200 caractères)
          </span>
          <input
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex. : Comment paramétrer une caisse Mercalys ?"
            className={INPUT}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending || text.trim() === ''}
          className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {create.isPending ? 'Ajout…' : 'Ajouter'}
        </button>
      </form>
      {create.isError && (
        <p className="mt-2 text-[13px] text-red">{create.error.message}</p>
      )}
    </div>
  )
}

function SuggestionEditField({
  suggestion,
  onDone,
}: {
  suggestion: Suggestion
  onDone: () => void
}) {
  const utils = trpc.useUtils()
  const [text, setText] = useState(suggestion.text)

  const update = trpc.admin.brainSuggestions.update.useMutation({
    onSuccess: async () => {
      await utils.admin.brainSuggestions.list.invalidate()
      onDone()
    },
  })

  return (
    <div className="flex items-center gap-2">
      <input
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        className={INPUT}
      />
      <button
        type="button"
        onClick={onDone}
        className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-sub hover:bg-sand/50"
      >
        Annuler
      </button>
      <button
        type="button"
        disabled={update.isPending || text.trim() === ''}
        onClick={() => update.mutate({ id: suggestion.id, text: text.trim() })}
        className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        {update.isPending ? '…' : 'OK'}
      </button>
    </div>
  )
}
```

Note : `INPUT` est référencé par `SuggestionEditField` — la constante est déclarée au niveau module, c'est voulu.

- [ ] **Step 2: Page admin**

Créer `src/app/admin/suggestions/page.tsx` :

```tsx
import { SuggestionsAdmin } from '@/components/admin/SuggestionsAdmin'

export default function AdminSuggestionsPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">
        Suggestions BRAIN
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Les questions proposées sous le chat BRAIN. Sans suggestion active, le
        chat affiche les questions par défaut.
      </p>
      <SuggestionsAdmin />
    </div>
  )
}
```

- [ ] **Step 3: Lien dans AdminNav**

Dans `src/components/admin/AdminNav.tsx`, ajouter une entrée à `NAV_ITEMS` (l'icône `brain` existe — utilisée par `BrainChat`) :

```ts
const NAV_ITEMS: ReadonlyArray<readonly [href: string, label: string, icon: string]> = [
  ['/admin/magasins', 'Magasins', 'pin'],
  ['/admin/formations', 'Formations', 'book'],
  ['/admin/actualites', 'Actualités', 'bell'],
  ['/admin/utilisateurs', 'Utilisateurs', 'user'],
  ['/admin/suggestions', 'Suggestions BRAIN', 'brain'],
]
```

- [ ] **Step 4: Vérifier types + lint + suite**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: 0 erreur.

- [ ] **Step 5: Commit**

```powershell
git add src/components/admin/SuggestionsAdmin.tsx src/app/admin/suggestions/page.tsx src/components/admin/AdminNav.tsx
git commit -m "feat(admin): BRAIN suggestions CRUD page with reordering"
```

---

# LOT 1 — Reset mot de passe

### Task 10: Schema zod `changePassword` (TDD)

**Files:**
- Create: `src/lib/account/schemas.ts`
- Test: `tests/lib/account-schemas.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/lib/account-schemas.test.ts` :

```ts
import { expect, test } from 'vitest'

import { changePasswordSchema } from '@/lib/account/schemas'

test('accepte un mdp actuel non vide et un nouveau ≥ 8 caractères', () => {
  expect(
    changePasswordSchema.safeParse({
      currentPassword: 'ancien123',
      newPassword: 'nouveau-mdp-1',
    }).success,
  ).toBe(true)
})

test('rejette un nouveau mdp trop court', () => {
  expect(
    changePasswordSchema.safeParse({
      currentPassword: 'ancien123',
      newPassword: 'court',
    }).success,
  ).toBe(false)
})

test('rejette un mdp actuel vide', () => {
  expect(
    changePasswordSchema.safeParse({
      currentPassword: '',
      newPassword: 'nouveau-mdp-1',
    }).success,
  ).toBe(false)
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `npx vitest run tests/lib/account-schemas.test.ts`
Expected: FAIL — module inexistant.

- [ ] **Step 3: Implémenter**

Créer `src/lib/account/schemas.ts` :

```ts
import { z } from 'zod'

/**
 * Zod input schemas for the account router. Server-free module so unit tests
 * can import it without the tRPC/auth runtime (same pattern as admin schemas).
 */

/** Input schema for `account.changePassword`. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run tests/lib/account-schemas.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/account/schemas.ts tests/lib/account-schemas.test.ts
git commit -m "feat(account): changePassword zod schema"
```

---

### Task 11: Router `account.changePassword`

**Files:**
- Create: `src/server/trpc/routers/account.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Créer le router**

Créer `src/server/trpc/routers/account.ts` :

```ts
import { eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'

import { users } from '@/server/db/schema'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { changePasswordSchema } from '@/lib/account/schemas'
import { protectedProcedure, router } from '../trpc'

/** Self-service account operations for the logged-in user. */
export const accountRouter = router({
  /**
   * Change the current user's password. Requires the current password to
   * match; the new password is stored as an argon2id hash. Never returns
   * any hash material.
   */
  changePassword: protectedProcedure
    .input(changePasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1)

      if (!row) throw new TRPCError({ code: 'UNAUTHORIZED' })

      const ok = await verifyPassword(row.passwordHash, input.currentPassword)
      if (!ok) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Mot de passe actuel incorrect',
        })
      }

      const passwordHash = await hashPassword(input.newPassword)
      await ctx.db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id))

      return { ok: true }
    }),
})
```

- [ ] **Step 2: Monter dans le root router**

Dans `src/server/trpc/root.ts`, ajouter l'import et l'entrée :

```ts
import { accountRouter } from './routers/account'
```

et dans `appRouter` :

```ts
  account: accountRouter,
```

- [ ] **Step 3: Vérifier types + lint**

Run: `npx tsc --noEmit; npm run lint`
Expected: 0 erreur.

- [ ] **Step 4: Commit**

```powershell
git add src/server/trpc/routers/account.ts src/server/trpc/root.ts
git commit -m "feat(account): self-service changePassword mutation"
```

---

### Task 12: `ChangePasswordForm` + page `/compte/mot-de-passe` (TDD)

**Files:**
- Create: `src/components/account/ChangePasswordForm.tsx`
- Create: `src/app/(app)/compte/mot-de-passe/page.tsx`
- Test: `tests/components/ChangePasswordForm.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/components/ChangePasswordForm.test.tsx` :

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ChangePasswordForm } from '@/components/account/ChangePasswordForm'

const { changeMutate } = vi.hoisted(() => ({ changeMutate: vi.fn() }))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    account: {
      changePassword: {
        useMutation: () => ({
          mutate: changeMutate,
          isPending: false,
          isError: false,
          isSuccess: false,
        }),
      },
    },
  },
}))

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => changeMutate.mockClear())

test('soumet quand les deux nouveaux mdp correspondent', () => {
  render(<ChangePasswordForm />)
  fill(/mot de passe actuel/i, 'ancien123')
  fill(/^nouveau mot de passe/i, 'nouveau-mdp-1')
  fill(/confirmer/i, 'nouveau-mdp-1')
  fireEvent.click(screen.getByRole('button', { name: /changer mon mot de passe/i }))
  expect(changeMutate).toHaveBeenCalledWith({
    currentPassword: 'ancien123',
    newPassword: 'nouveau-mdp-1',
  })
})

test('bloque et affiche une erreur si la confirmation diffère', () => {
  render(<ChangePasswordForm />)
  fill(/mot de passe actuel/i, 'ancien123')
  fill(/^nouveau mot de passe/i, 'nouveau-mdp-1')
  fill(/confirmer/i, 'autre-chose')
  fireEvent.click(screen.getByRole('button', { name: /changer mon mot de passe/i }))
  expect(changeMutate).not.toHaveBeenCalled()
  expect(screen.getByText(/ne correspondent pas/i)).toBeInTheDocument()
})

test('bloque si le nouveau mdp fait moins de 8 caractères', () => {
  render(<ChangePasswordForm />)
  fill(/mot de passe actuel/i, 'ancien123')
  fill(/^nouveau mot de passe/i, 'court')
  fill(/confirmer/i, 'court')
  fireEvent.click(screen.getByRole('button', { name: /changer mon mot de passe/i }))
  expect(changeMutate).not.toHaveBeenCalled()
  expect(screen.getByText(/8 caractères/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `npx vitest run tests/components/ChangePasswordForm.test.tsx`
Expected: FAIL — module inexistant.

- [ ] **Step 3: Implémenter le composant**

Créer `src/components/account/ChangePasswordForm.tsx` :

```tsx
'use client'

import { useState } from 'react'

import { trpc } from '@/lib/trpc/client'

const INPUT =
  'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px] focus:border-ink focus:outline-none'
const LABEL = 'mb-1 block text-[12px] font-medium text-sub'

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)

  const change = trpc.account.changePassword.useMutation({
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      setClientError(null)
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      setClientError('Le nouveau mot de passe doit faire au moins 8 caractères.')
      return
    }
    if (newPassword !== confirm) {
      setClientError('Les deux nouveaux mots de passe ne correspondent pas.')
      return
    }
    setClientError(null)
    change.mutate({ currentPassword, newPassword })
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 max-w-[420px] rounded-[14px] border border-line bg-card p-5"
    >
      <div className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="current-password">
            Mot de passe actuel
          </label>
          <input
            id="current-password"
            className={INPUT}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="new-password">
            Nouveau mot de passe (min. 8 caractères)
          </label>
          <input
            id="new-password"
            className={INPUT}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="confirm-password">
            Confirmer le nouveau mot de passe
          </label>
          <input
            id="confirm-password"
            className={INPUT}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>

      {clientError && <p className="mt-3 text-[13px] text-red">{clientError}</p>}
      {change.isError && (
        <p className="mt-3 text-[13px] text-red">{change.error.message}</p>
      )}
      {change.isSuccess && (
        <p className="mt-3 text-[13px] font-medium text-ink">
          Mot de passe modifié.
        </p>
      )}

      <button
        type="submit"
        disabled={
          change.isPending ||
          currentPassword === '' ||
          newPassword === '' ||
          confirm === ''
        }
        className="mt-4 rounded-lg bg-red px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-50"
      >
        {change.isPending ? 'Enregistrement…' : 'Changer mon mot de passe'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run tests/components/ChangePasswordForm.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Créer la page**

Créer `src/app/(app)/compte/mot-de-passe/page.tsx` :

```tsx
import { ChangePasswordForm } from '@/components/account/ChangePasswordForm'

export default function ChangePasswordPage() {
  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-8 md:px-10">
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">
        Mon compte
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Changez votre mot de passe de connexion au Cockpit.
      </p>
      <ChangePasswordForm />
    </div>
  )
}
```

- [ ] **Step 6: Vérifier types + lint**

Run: `npx tsc --noEmit; npm run lint`
Expected: 0 erreur.

- [ ] **Step 7: Commit**

```powershell
git add src/components/account/ChangePasswordForm.tsx "src/app/(app)/compte/mot-de-passe/page.tsx" tests/components/ChangePasswordForm.test.tsx
git commit -m "feat(account): change-password page and form"
```

---

### Task 13: Avatar BNav → lien vers la page compte

**Files:**
- Modify: `src/components/nav/BNav.tsx` (avatar initiales, lignes ~83-85)

- [ ] **Step 1: Rendre l'avatar cliquable**

Dans `src/components/nav/BNav.tsx`, remplacer la div avatar :

```tsx
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sand text-[13px] font-bold">
          {initials(firstName)}
        </div>
```

par :

```tsx
        <Link
          href="/compte/mot-de-passe"
          title="Changer mon mot de passe"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-sand text-[13px] font-bold transition-colors hover:bg-line"
        >
          {initials(firstName)}
        </Link>
```

(`Link` est déjà importé ligne 3.)

- [ ] **Step 2: Vérifier types + lint + suite**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```powershell
git add src/components/nav/BNav.tsx
git commit -m "feat(nav): avatar links to the change-password page"
```

---

### Task 14: Reset mdp par admin (mutation + UI)

**Files:**
- Modify: `src/server/trpc/routers/admin.ts` (usersRouter)
- Modify: `src/components/admin/UtilisateursAdmin.tsx`

- [ ] **Step 1: Mutation `admin.users.resetPassword`**

Dans `src/server/trpc/routers/admin.ts`, ajouter dans `usersRouter` (après `update`, avant `bulkCreate`) :

```ts
  /**
   * Reset a user's password to a fresh server-generated one. Only the argon2
   * hash is stored; the plaintext is returned ONCE so the admin can hand it
   * over (same pattern as CSV bulk import).
   */
  resetPassword: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const password = generatePassword()
      const passwordHash = await hashPassword(password)

      const [row] = await ctx.db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, input.id))
        .returning({ id: users.id, email: users.email })

      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' })
      return { id: row.id, email: row.email, password }
    }),
```

(`generatePassword`, `hashPassword`, `TRPCError`, `eq`, `z` sont déjà importés dans ce fichier.)

- [ ] **Step 2: Vérifier types**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: UI — bouton + encart résultat**

Dans `src/components/admin/UtilisateursAdmin.tsx` :

1. Dans `UtilisateursAdmin`, ajouter un state et la mutation (après `const [editing, setEditing] = useState<string | null>(null)`) :

```tsx
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const resetPassword = trpc.admin.users.resetPassword.useMutation({
    onSuccess: (data) => {
      setResetResult({ email: data.email, password: data.password })
      setCopied(false)
    },
  })
```

2. Juste au-dessus du tableau (avant `<div className="overflow-hidden rounded-[14px]…">`), afficher l'encart résultat :

```tsx
      {resetResult && (
        <div className="rounded-[14px] border border-red/40 bg-surface p-4">
          <p className="text-[14px] font-semibold text-ink">
            Nouveau mot de passe pour {resetResult.email}
          </p>
          <p className="mt-1 text-[13px] text-sub">
            Transmettez-le maintenant — il ne sera plus affiché ensuite.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <code className="rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-[15px]">
              {resetResult.password}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(resetResult.password)
                setCopied(true)
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
            >
              {copied ? 'Copié ✓' : 'Copier'}
            </button>
            <button
              type="button"
              onClick={() => setResetResult(null)}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-sub hover:bg-sand/50"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
      {resetPassword.isError && (
        <p className="text-[13px] text-red">{resetPassword.error.message}</p>
      )}
```

3. Dans la ligne du tableau (cellule actions, à côté du bouton « Modifier »), ajouter le bouton reset :

```tsx
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    <button
                      type="button"
                      onClick={() => setEditing(u.id)}
                      className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      disabled={resetPassword.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Réinitialiser le mot de passe de ${u.email} ? L'ancien ne fonctionnera plus.`,
                          )
                        ) {
                          resetPassword.mutate({ id: u.id })
                        }
                      }}
                      className="ml-2 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-red hover:bg-sand/50 disabled:opacity-50"
                    >
                      Réinitialiser mdp
                    </button>
                  </td>
```

(Remplacer la cellule actions existante — `className={`${TD} text-right`}` devient `whitespace-nowrap text-right`.)

- [ ] **Step 4: Vérifier types + lint + suite**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: 0 erreur, tous les tests verts.

- [ ] **Step 5: Commit**

```powershell
git add src/server/trpc/routers/admin.ts src/components/admin/UtilisateursAdmin.tsx
git commit -m "feat(admin): one-shot password reset with copyable plaintext panel"
```

---

### Task 15: Vérification finale + smoke test manuel + push

**Files:** aucun nouveau.

- [ ] **Step 1: Suite complète + lint + types**

Run: `npm test; npm run lint; npx tsc --noEmit`
Expected: ~130 tests verts (≥ 119 existants + 11 nouveaux), lint propre, 0 erreur de type.

- [ ] **Step 2: Smoke test dev (DB locale port 5433 démarrée)**

Run: `docker start formaps_postgres; npm run dev`

Vérifier dans le navigateur (`admin@aps.fr` / `admin1234`, employé `camille@aps.fr` / `camille1234`) :
1. `/formations/<slug>` : bouton « Marquer comme terminée » → passe à 100 % → lien « Marquer comme non terminée » → revient à 0 %.
2. `/admin/suggestions` : créer 2 suggestions, réordonner, désactiver une → `/brain` reflète l'ordre et le filtre ; tout supprimer → `/brain` affiche les 4 questions par défaut.
3. `/admin/utilisateurs` : « Réinitialiser mdp » sur camille → encart mdp → se reconnecter avec ce mdp.
4. Avatar BNav → `/compte/mot-de-passe` → changer le mdp (mauvais mdp actuel → erreur ; confirmé → succès, reconnexion OK).

- [ ] **Step 3: Push (Dokploy auto-déploie depuis main)**

```powershell
git push
```

Expected: push accepté ; vérifier ensuite que le déploiement Dokploy passe healthy.
