# Auth JWT Session Invalidation — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invalider toutes les sessions JWT d'un utilisateur dès que son mot de passe change (self-service ou admin), avec une déconnexion propre côté UX et les tests serveur Phase 2 manquants.

**Architecture:** Claim `passwordChangedAt` (epoch ms) embarqué dans le token à la connexion ; callback `jwt` Node-side (`auth.ts`) qui compare le claim à la DB à chaque lecture et retourne `null` (session morte) en cas de mismatch — couvre les 10 call sites `auth()`. Fail-open sur erreur DB. Spec : `docs/superpowers/specs/2026-06-05-auth-session-invalidation-design.md`.

**Tech Stack:** Next.js 16, Auth.js v5 (next-auth@beta, JWT strategy), Drizzle/Postgres, tRPC v11, vitest. Tests DB toujours mockés.

**Conventions:** TDD strict (RED observé avant GREEN). `pnpm test` + `pnpm lint` avant chaque commit. Code/commits en anglais, UI en français. Commits single-line `-m` (PowerShell 5.1).

---

### Task 1 : Colonne `passwordChangedAt` (schéma + migration)

**Files:**
- Modify: `src/server/db/schema.ts` (table `users`)
- Create: `drizzle/0004_*.sql` (généré)

Schéma déclaratif — pas de test unitaire (exception TDD config) ; validation par inspection du SQL.

- [ ] **Step 1 : Ajouter la colonne**

Dans `src/server/db/schema.ts`, table `users`, après `passwordHash` :

```ts
  passwordHash: text('password_hash').notNull(),
  // Bumped on every password change/reset; tokens carry it as a claim and any
  // mismatch kills the session (see src/server/auth/token-validation.ts).
  passwordChangedAt: timestamp('password_changed_at').defaultNow().notNull(),
```

- [ ] **Step 2 : Générer la migration**

Run: `pnpm drizzle-kit generate`
Expected: `drizzle/0004_<nom>.sql` contenant uniquement
`ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp DEFAULT now() NOT NULL;`
— rien d'autre (pas de DROP, pas d'ALTER sur d'autres tables).

- [ ] **Step 3 : Suite verte**

Run: `pnpm test` puis `pnpm lint`
Expected: 175 tests verts (la colonne n'est consommée nulle part encore), lint propre.

- [ ] **Step 4 : Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(db): users.passwordChangedAt column for JWT invalidation"
```

---

### Task 2 : Module `token-validation.ts` (pur + DB, fail-open)

**Files:**
- Create: `src/server/auth/token-validation.ts`
- Test: `tests/server/token-validation.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/server/token-validation.test.ts` :

```ts
import { expect, test, vi } from 'vitest'

import { isTokenStale, validatePasswordFreshness } from '@/server/auth/token-validation'

// --- isTokenStale (pur) ---------------------------------------------------

test('claim absent (vieux token pré-déploiement) → stale', () => {
  expect(isTokenStale(undefined, new Date('2026-06-01T10:00:00Z'))).toBe(true)
})

test('user introuvable (dbValue null) → stale', () => {
  expect(isTokenStale(1764583200000, null)).toBe(true)
})

test('claim égal à la DB → fresh', () => {
  const d = new Date('2026-06-01T10:00:00Z')
  expect(isTokenStale(d.getTime(), d)).toBe(false)
})

test('claim différent (mot de passe changé depuis) → stale', () => {
  const issued = new Date('2026-06-01T10:00:00Z')
  const changed = new Date('2026-06-02T08:00:00Z')
  expect(isTokenStale(issued.getTime(), changed)).toBe(true)
})

// --- validatePasswordFreshness (db injectée) ------------------------------

function makeDb(result: Promise<Array<{ passwordChangedAt: Date }>>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => result) })),
      })),
    })),
  } as never
}

const NOW = new Date('2026-06-01T10:00:00Z')

test('claim aligné sur la DB → fresh', async () => {
  const db = makeDb(Promise.resolve([{ passwordChangedAt: NOW }]))
  await expect(
    validatePasswordFreshness({ sub: 'u1', passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toBe('fresh')
})

test('mot de passe changé depuis l’émission → stale', async () => {
  const db = makeDb(Promise.resolve([{ passwordChangedAt: new Date('2026-06-02T08:00:00Z') }]))
  await expect(
    validatePasswordFreshness({ sub: 'u1', passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toBe('stale')
})

test('user disparu → stale', async () => {
  const db = makeDb(Promise.resolve([]))
  await expect(
    validatePasswordFreshness({ sub: 'gone', passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toBe('stale')
})

test('token sans sub → stale', async () => {
  const db = makeDb(Promise.resolve([]))
  await expect(
    validatePasswordFreshness({ passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toBe('stale')
})

test('erreur DB → fresh (fail-open) + erreur loggée', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const db = makeDb(Promise.reject(new Error('db down')))
  await expect(
    validatePasswordFreshness({ sub: 'u1', passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toBe('fresh')
  expect(consoleError).toHaveBeenCalled()
  consoleError.mockRestore()
})
```

- [ ] **Step 2 : Vérifier RED**

Run: `pnpm vitest run tests/server/token-validation.test.ts`
Expected: FAIL — module inexistant.

- [ ] **Step 3 : Implémenter**

Créer `src/server/auth/token-validation.ts` :

```ts
import { eq } from 'drizzle-orm'

import type { db } from '@/server/db'
import { users } from '@/server/db/schema'

/**
 * Password-freshness check backing JWT session invalidation.
 *
 * Tokens carry a `passwordChangedAt` claim (epoch ms) stamped at sign-in.
 * On every Node-side session read, the claim is compared to the DB value by
 * EXACT equality — any password change/reset bumps the column and kills every
 * token issued before it. `import type` keeps this module free of the db
 * singleton's import-time env requirements (tests inject a mock).
 */

type Db = typeof db

type FreshnessToken = {
  sub?: string
  passwordChangedAt?: number
}

/**
 * A token is stale when its claim is missing (token pre-dates this feature —
 * the whole fleet re-logs once at first deploy), when the user no longer
 * exists, or when the claim differs from the DB value.
 */
export function isTokenStale(tokenValue: number | undefined, dbValue: Date | null): boolean {
  if (tokenValue === undefined) return true
  if (dbValue === null) return true
  return tokenValue !== dbValue.getTime()
}

/**
 * Reads the user's current passwordChangedAt and compares it to the token's
 * claim. DB errors fail OPEN ('fresh') so a transient Postgres outage never
 * logs the whole portal out — the check is a hardening layer, not the primary
 * authentication (the JWT signature is).
 */
export async function validatePasswordFreshness(
  token: FreshnessToken,
  dbClient: Db,
): Promise<'fresh' | 'stale'> {
  if (!token.sub) return 'stale'
  try {
    const [row] = await dbClient
      .select({ passwordChangedAt: users.passwordChangedAt })
      .from(users)
      .where(eq(users.id, token.sub))
      .limit(1)
    return isTokenStale(token.passwordChangedAt, row?.passwordChangedAt ?? null)
      ? 'stale'
      : 'fresh'
  } catch (err) {
    console.error('[auth] vérification passwordChangedAt a échoué (fail-open):', err)
    return 'fresh'
  }
}
```

- [ ] **Step 4 : Vérifier GREEN + suite**

Run: `pnpm vitest run tests/server/token-validation.test.ts` puis `pnpm test` + `pnpm lint`
Expected: 9/9 puis suite complète verte.

- [ ] **Step 5 : Commit**

```bash
git add src/server/auth/token-validation.ts tests/server/token-validation.test.ts
git commit -m "feat(auth): password-freshness token validation (fail-open on db errors)"
```

---

### Task 3 : Claim dans le token + callback jwt Node-side

**Files:**
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/server/auth.config.ts` (callback jwt partagé : copie du claim)
- Modify: `src/server/auth.ts` (authorize + surcharge du callback jwt, export `nodeJwtCallback`)
- Test: `tests/server/auth-jwt-callback.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/server/auth-jwt-callback.test.ts` :

```ts
import { beforeEach, expect, test, vi } from 'vitest'

const { selectLimit } = vi.hoisted(() => ({ selectLimit: vi.fn() }))

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: selectLimit })),
      })),
    })),
  },
}))
// argon2 est natif et inutile ici — on neutralise le module password.
vi.mock('@/server/auth/password', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}))

// auth.ts jette à l'import sans AUTH_SECRET ; on le pose AVANT l'import dynamique.
process.env.AUTH_SECRET = 'test-secret'
const { nodeJwtCallback } = await import('@/server/auth')

const NOW = new Date('2026-06-01T10:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
})

test('sign-in : stash les claims (dont passwordChangedAt) sur le token', async () => {
  const token = await nodeJwtCallback({
    token: { sub: 'u1' },
    user: {
      id: 'u1',
      email: 'a@b.fr',
      firstName: 'Léa',
      role: 'employee',
      storeId: null,
      passwordChangedAt: NOW.getTime(),
    },
  } as never)

  expect(token).toMatchObject({
    role: 'employee',
    storeId: null,
    firstName: 'Léa',
    passwordChangedAt: NOW.getTime(),
  })
})

test('lecture : claim aligné sur la DB → token rendu', async () => {
  selectLimit.mockResolvedValue([{ passwordChangedAt: NOW }])
  const token = await nodeJwtCallback({
    token: { sub: 'u1', passwordChangedAt: NOW.getTime() },
  } as never)
  expect(token).toMatchObject({ sub: 'u1' })
})

test('lecture : mot de passe changé depuis → null (session tuée)', async () => {
  selectLimit.mockResolvedValue([{ passwordChangedAt: new Date('2026-06-02T08:00:00Z') }])
  const token = await nodeJwtCallback({
    token: { sub: 'u1', passwordChangedAt: NOW.getTime() },
  } as never)
  expect(token).toBeNull()
})

test('lecture : erreur DB → token rendu (fail-open)', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  selectLimit.mockRejectedValue(new Error('db down'))
  const token = await nodeJwtCallback({
    token: { sub: 'u1', passwordChangedAt: NOW.getTime() },
  } as never)
  expect(token).toMatchObject({ sub: 'u1' })
  consoleError.mockRestore()
})
```

- [ ] **Step 2 : Vérifier RED**

Run: `pnpm vitest run tests/server/auth-jwt-callback.test.ts`
Expected: FAIL — `nodeJwtCallback` n'est pas exporté par `@/server/auth`.

- [ ] **Step 3 : Types**

Dans `src/types/next-auth.d.ts` :

- interface `User` : ajouter `passwordChangedAt: number` (avec le commentaire `/** Epoch ms du dernier changement de mot de passe — copié sur le JWT au sign-in. */`)
- interface `JWT` (module `@auth/core/jwt`) : ajouter `passwordChangedAt?: number` (optionnel — les tokens émis avant ce déploiement ne l'ont pas).

- [ ] **Step 4 : `authorize` retourne le claim**

Dans `src/server/auth.ts`, dans le `return` de `authorize` :

```ts
        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          role: user.role,
          storeId: user.storeId,
          passwordChangedAt: user.passwordChangedAt.getTime(),
        }
```

- [ ] **Step 5 : Callback partagé copie le claim**

Dans `src/server/auth.config.ts`, callback `jwt`, bloc `if (user)` :

```ts
    jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.storeId = user.storeId
        token.firstName = user.firstName
        token.passwordChangedAt = user.passwordChangedAt
      }
      return token
    },
```

(Ce callback reste edge-safe : pure copie, pas de DB.)

- [ ] **Step 6 : Surcharge Node-side dans `auth.ts`**

Dans `src/server/auth.ts` :

Imports à ajouter :

```ts
import type { NextAuthConfig } from 'next-auth'

import { validatePasswordFreshness } from './auth/token-validation'
```

Avant l'appel `NextAuth({...})`, définir et exporter le callback (exporté pour le test) :

```ts
type JwtCallback = NonNullable<NonNullable<NextAuthConfig['callbacks']>['jwt']>

/**
 * Node-side jwt callback. At sign-in it delegates to the shared (edge-safe)
 * callback that stamps the claims. On every subsequent session read it kills
 * the token (return null → Auth.js invalidates the session) when the password
 * changed since the token was issued. DB errors fail open — see
 * token-validation.ts.
 */
export const nodeJwtCallback: JwtCallback = async (params) => {
  if (params.user) {
    return authConfig.callbacks.jwt(params)
  }
  if ((await validatePasswordFreshness(params.token, db)) === 'stale') {
    return null
  }
  return params.token
}
```

Et dans l'appel `NextAuth({ ...authConfig, ... })`, ajouter :

```ts
  callbacks: {
    ...authConfig.callbacks,
    jwt: nodeJwtCallback,
  },
```

(L'objet `callbacks` de `auth.ts` ÉCRASE celui spreadé par `...authConfig` — le callback
`session` partagé doit donc être re-spreadé comme ci-dessus, pas omis.)

- [ ] **Step 7 : Vérifier GREEN + suite**

Run: `pnpm vitest run tests/server/auth-jwt-callback.test.ts` puis `pnpm test` + `pnpm lint`
Expected: 4/4 puis suite complète verte (les tests existants qui mockent `@/server/auth` ne sont pas affectés).

- [ ] **Step 8 : Commit**

```bash
git add src/types/next-auth.d.ts src/server/auth.config.ts src/server/auth.ts tests/server/auth-jwt-callback.test.ts
git commit -m "feat(auth): kill JWT sessions when password changed since issuance"
```

---

### Task 4 : Chemin d'écriture self-service + tests serveur Phase 2 (`changePassword`)

**Files:**
- Modify: `src/server/trpc/routers/account.ts`
- Test: `tests/server/account-password.test.ts` (nouveau — dette Phase 2)

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/server/account-password.test.ts` :

```ts
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { hashPassword, verifyPassword } = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}))
vi.mock('@/server/auth/password', () => ({ hashPassword, verifyPassword }))

const selectLimit = vi.fn()
const updateWhere = vi.fn().mockResolvedValue(undefined)
const updateSet = vi.fn(() => ({ where: updateWhere }))
const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimit })) })),
  })),
  update: vi.fn(() => ({ set: updateSet })),
} as never

import { accountRouter } from '@/server/trpc/routers/account'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(accountRouter)

function caller() {
  return createCaller({
    session: {
      user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa', email: 'a@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  selectLimit.mockResolvedValue([{ passwordHash: 'old-hash' }])
  verifyPassword.mockResolvedValue(true)
  hashPassword.mockResolvedValue('new-hash')
  updateWhere.mockResolvedValue(undefined)
})

test('mot de passe actuel incorrect → UNAUTHORIZED, aucun write', async () => {
  verifyPassword.mockResolvedValue(false)

  await expect(
    caller().changePassword({ currentPassword: 'wrong', newPassword: 'newpass123' }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  expect(updateSet).not.toHaveBeenCalled()
})

test('succès → hash mis à jour + passwordChangedAt posé', async () => {
  const result = await caller().changePassword({
    currentPassword: 'oldpass',
    newPassword: 'newpass123',
  })

  expect(result).toEqual({ ok: true })
  expect(hashPassword).toHaveBeenCalledWith('newpass123')
  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({
      passwordHash: 'new-hash',
      passwordChangedAt: expect.any(Date),
    }),
  )
})

test('user introuvable en base → UNAUTHORIZED', async () => {
  selectLimit.mockResolvedValue([])
  await expect(
    caller().changePassword({ currentPassword: 'x', newPassword: 'newpass123' }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
})
```

- [ ] **Step 2 : Vérifier RED**

Run: `pnpm vitest run tests/server/account-password.test.ts`
Expected: les tests « UNAUTHORIZED » passent déjà (comportement existant) ; le test
« succès » FAIL sur l'assertion `passwordChangedAt: expect.any(Date)` (champ absent du SET).

- [ ] **Step 3 : Implémenter**

Dans `src/server/trpc/routers/account.ts`, mutation `changePassword`, le `.set` devient :

```ts
      await ctx.db
        .update(users)
        .set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id))
```

- [ ] **Step 4 : Vérifier GREEN + suite**

Run: `pnpm vitest run tests/server/account-password.test.ts` puis `pnpm test` + `pnpm lint`
Expected: 3/3 puis suite complète verte.

- [ ] **Step 5 : Commit**

```bash
git add src/server/trpc/routers/account.ts tests/server/account-password.test.ts
git commit -m "feat(account): bump passwordChangedAt on self-service change + server tests"
```

---

### Task 5 : Chemins d'écriture admin + tests serveur Phase 2 (`users.update`, `resetPassword`)

**Files:**
- Modify: `src/server/trpc/routers/admin.ts` (usersRouter : `update` + `resetPassword`)
- Test: `tests/server/admin-users-password.test.ts` (nouveau — dette Phase 2)

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/server/admin-users-password.test.ts` :

```ts
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { hashPassword, verifyPassword, generatePassword } = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  generatePassword: vi.fn(),
}))
vi.mock('@/server/auth/password', () => ({ hashPassword, verifyPassword }))
vi.mock('@/server/auth/generate-password', () => ({ generatePassword }))

const updateReturning = vi.fn()
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn(() => ({ where: updateWhere }))
const dbMock = { update: vi.fn(() => ({ set: updateSet })) } as never

import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)

const USER_ID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'

function caller() {
  return createCaller({
    session: {
      user: { id: 'admin1', role: 'admin', storeId: null, firstName: 'Admin', email: 'adm@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  hashPassword.mockResolvedValue('fresh-hash')
  generatePassword.mockReturnValue('Generated1234')
  updateReturning.mockResolvedValue([
    { id: USER_ID, email: 'u@b.fr', firstName: 'Léa', role: 'employee', storeId: null },
  ])
})

test('users.update AVEC password → hash + passwordChangedAt posés', async () => {
  await caller().users.update({ id: USER_ID, password: 'newpass123' })

  expect(hashPassword).toHaveBeenCalledWith('newpass123')
  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({
      passwordHash: 'fresh-hash',
      passwordChangedAt: expect.any(Date),
    }),
  )
})

test('users.update SANS password → passwordChangedAt PAS touché', async () => {
  await caller().users.update({ id: USER_ID, firstName: 'Mia' })

  expect(hashPassword).not.toHaveBeenCalled()
  const setArg = updateSet.mock.calls[0][0] as Record<string, unknown>
  expect(setArg).not.toHaveProperty('passwordChangedAt')
  expect(setArg).not.toHaveProperty('passwordHash')
})

test('resetPassword → plaintext retourné une fois + hash + passwordChangedAt posés', async () => {
  const result = await caller().users.resetPassword({ id: USER_ID })

  expect(result).toEqual({ id: USER_ID, email: 'u@b.fr', password: 'Generated1234' })
  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({
      passwordHash: 'fresh-hash',
      passwordChangedAt: expect.any(Date),
    }),
  )
})

test('resetPassword : user inconnu → NOT_FOUND', async () => {
  updateReturning.mockResolvedValue([])
  await expect(caller().users.resetPassword({ id: USER_ID })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
})
```

NOTE : `admin.ts` importe `fs`/`path` (gestion documents) et plusieurs libs — l'import du
router complet fonctionne en environnement node vitest. Si un import jette à cause d'une
env manquante, mocker le module fautif et le signaler dans le rapport.

- [ ] **Step 2 : Vérifier RED**

Run: `pnpm vitest run tests/server/admin-users-password.test.ts`
Expected: les tests « update avec password » et « resetPassword » FAIL sur
`passwordChangedAt: expect.any(Date)` ; les deux autres passent (comportement existant).

- [ ] **Step 3 : Implémenter**

Dans `src/server/trpc/routers/admin.ts` :

`users.update` — le bloc password devient :

```ts
    const fields: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (password !== undefined) {
      fields.passwordHash = await hashPassword(password)
      fields.passwordChangedAt = new Date()
    }
```

`users.resetPassword` — le `.set` devient :

```ts
      const [row] = await ctx.db
        .update(users)
        .set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, input.id))
        .returning({ id: users.id, email: users.email })
```

- [ ] **Step 4 : Vérifier GREEN + suite**

Run: `pnpm vitest run tests/server/admin-users-password.test.ts` puis `pnpm test` + `pnpm lint`
Expected: 4/4 puis suite complète verte.

- [ ] **Step 5 : Commit**

```bash
git add src/server/trpc/routers/admin.ts tests/server/admin-users-password.test.ts
git commit -m "feat(admin): bump passwordChangedAt on admin password update/reset + server tests"
```

---

### Task 6 : UX — signOut après self-change + bannière `/connexion?changed=1`

**Files:**
- Modify: `src/components/account/ChangePasswordForm.tsx`
- Modify: `src/app/(auth)/connexion/page.tsx`
- Test: `tests/components/ChangePasswordForm.test.tsx` (existant — adapter)
- Test: `tests/components/ConnexionPage.test.tsx` (nouveau)

- [ ] **Step 1 : Adapter le test du formulaire (RED d'abord)**

Lire `tests/components/ChangePasswordForm.test.tsx` (existant). Y ajouter un mock de
`next-auth/react` (vi.hoisted) :

```tsx
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('next-auth/react', () => ({ signOut }))
```

Puis ajouter/adapter le test du succès : le `onSuccess` de la mutation doit appeler
`signOut({ callbackUrl: '/connexion?changed=1' })` (même convention que `LogoutButton.tsx`).
Si un test existant asserte le message « Mot de passe modifié. », le REMPLACER par
l'assertion signOut (le message disparaît — l'utilisateur est redirigé).

```tsx
test('succès → signOut vers /connexion?changed=1', async () => {
  // selon le harnais existant du fichier : déclencher la mutation avec succès,
  // puis :
  expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/connexion?changed=1' })
})
```

(Adapter au style exact du fichier existant — il mocke déjà trpc ; réutiliser son
mécanisme pour faire réussir la mutation.)

- [ ] **Step 2 : Écrire le test de la page connexion (RED)**

Créer `tests/components/ConnexionPage.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

// LoginForm utilise next-auth/react + navigation — on le neutralise, la page
// est testée pour sa bannière, pas pour le formulaire.
vi.mock('@/components/auth/LoginForm', () => ({ LoginForm: () => <div /> }))

import ConnexionPage from '@/app/(auth)/connexion/page'

test('?changed=1 → bannière « Mot de passe modifié, reconnectez-vous. »', async () => {
  render(await ConnexionPage({ searchParams: Promise.resolve({ changed: '1' }) }))
  expect(screen.getByText(/mot de passe modifié, reconnectez-vous/i)).toBeInTheDocument()
})

test('sans param → pas de bannière', async () => {
  render(await ConnexionPage({ searchParams: Promise.resolve({}) }))
  expect(screen.queryByText(/reconnectez-vous/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 3 : Vérifier RED**

Run: `pnpm vitest run tests/components/ChangePasswordForm.test.tsx tests/components/ConnexionPage.test.tsx`
Expected: FAIL — signOut jamais appelé ; ConnexionPage n'accepte pas searchParams.

- [ ] **Step 4 : Implémenter le formulaire**

Dans `src/components/account/ChangePasswordForm.tsx` :

```tsx
import { signOut } from 'next-auth/react'
```

```tsx
  const change = trpc.account.changePassword.useMutation({
    onSuccess: () => {
      // La mutation a bumpé passwordChangedAt : la session courante est morte.
      // Déconnexion propre + message sur la page de connexion.
      void signOut({ callbackUrl: '/connexion?changed=1' })
    },
  })
```

Supprimer le bloc `{change.isSuccess && (...)}` (le composant navigue ailleurs).
Garder les resets de champs ? Non — inutiles, la page est quittée ; les retirer.

- [ ] **Step 5 : Implémenter la page connexion**

Dans `src/app/(auth)/connexion/page.tsx` — Next 16 : `searchParams` est une **Promise**
(vérifier `node_modules/next/dist/docs/` en cas de doute, cf. AGENTS.md) :

```tsx
export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>
}) {
  const { changed } = await searchParams
  // ... JSX existant inchangé jusqu'au <h2> « Se connecter », puis juste avant
  // le <LoginForm /> :
```

```tsx
          {changed === '1' && (
            <p className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink">
              Mot de passe modifié, reconnectez-vous.
            </p>
          )}

          <LoginForm />
```

- [ ] **Step 6 : Vérifier GREEN + suite**

Run: `pnpm vitest run tests/components/ChangePasswordForm.test.tsx tests/components/ConnexionPage.test.tsx` puis `pnpm test` + `pnpm lint`
Expected: tout vert.

- [ ] **Step 7 : Commit**

```bash
git add src/components/account/ChangePasswordForm.tsx src/app/(auth)/connexion/page.tsx tests/components/ChangePasswordForm.test.tsx tests/components/ConnexionPage.test.tsx
git commit -m "feat(account): sign out after password change with login-page notice"
```

---

### Task 7 : Vérification finale

- [ ] **Step 1 : Suite complète + lint**

Run: `pnpm test` puis `pnpm lint`
Expected: tous verts.

- [ ] **Step 2 : Build de prod**

Run: `pnpm build`
Expected: build OK (vérifie le typage NextAuth augmenté + la page connexion async).

- [ ] **Step 3 : Smoke test manuel (Postgres dev :5433 requis)**

C'est LE test du comportement Auth.js `return null` (non couvert en vitest) :

1. `pnpm dev` ; se connecter avec `camille@aps.fr` dans le navigateur A **et** dans
   une fenêtre privée B.
2. Dans A : `/compte/mot-de-passe` → changer le mot de passe → A est déconnectée
   et atterrit sur `/connexion?changed=1` avec la bannière.
3. Dans B : recharger n'importe quelle page → redirection `/connexion` (session
   tuée par le callback). Une requête BRAIN dans B → 401.
4. Se reconnecter avec le NOUVEAU mot de passe → tout fonctionne (le nouveau token
   porte le bon claim — pas de boucle de déconnexion).
5. Si l'étape 3 ou 4 échoue : STOP, ne pas pousser — investiguer le comportement
   du callback (spec §3, fallback = vérif dans le callback `session`).

- [ ] **Step 4 : Push (Dokploy auto-déploie, migration au boot)**

```bash
git push origin main
```

NOTE déploiement : au premier boot post-deploy, TOUTES les sessions existantes
sont invalidées (tokens sans claim) — chaque salarié se reconnecte une fois.
Comportement assumé (spec §3).
