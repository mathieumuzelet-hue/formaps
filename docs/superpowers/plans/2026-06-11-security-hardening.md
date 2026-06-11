# Security Hardening (PR ⑥) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the security findings from the 2026-06-09 audit: login rate-limiting + timing oracle, email normalization, fresh JWT claims, last-admin guard, tRPC errorFormatter, automated GDPR purge, HTTP security headers, and assorted hardening (password max, sharepointUrl scheme, UNIQUE stores.name, Cache-Control).

**Architecture:** All changes are server-side hardening in the existing Next.js 16 + tRPC + Drizzle stack. New modules: `src/lib/email.ts` (normalize), `src/server/auth/rate-limit.ts` (in-memory limiter), `src/server/jobs/purge-chat-queries.ts` + `src/instrumentation.ts` (GDPR purge), `src/server/trpc/error-format.ts` (mask helper). One additive migration (0008) normalizes emails and adds unique constraints. Spec: `docs/superpowers/specs/2026-06-11-security-hardening-design.md`.

**Tech Stack:** Next.js 16.2.7 (App Router, instrumentation hook), Auth.js v5 beta (credentials), Drizzle ORM 0.45 / drizzle-kit 0.31, zod, vitest.

**Conventions:**
- Branch: `feat/security-hardening` (already created, spec committed).
- Tests live in `tests/` mirroring `src/` (`tests/lib/`, `tests/server/`).
- Run a single test file: `npx vitest run tests/path/file.test.ts`.
- Full gate before each commit: the task says which. Final gate: `npm run lint && npm run typecheck && npm test`.
- Code/comments in the codebase mix French (domain) and English (mechanics) — follow the file you touch.
- UI-facing error messages are French.

---

### Task 1: `normalizeEmail` helper

**Files:**
- Create: `src/lib/email.ts`
- Test: `tests/lib/email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/email.test.ts
import { describe, expect, it } from 'vitest'

import { normalizeEmail } from '@/lib/email'

describe('normalizeEmail', () => {
  it('lowercases the address', () => {
    expect(normalizeEmail('Camille@APS.fr')).toBe('camille@aps.fr')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  camille@aps.fr ')).toBe('camille@aps.fr')
  })

  it('leaves an already-normalized address unchanged', () => {
    expect(normalizeEmail('camille@aps.fr')).toBe('camille@aps.fr')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/email.test.ts`
Expected: FAIL — cannot resolve `@/lib/email`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/email.ts
/**
 * Canonical email form used by EVERY read/write path (authorize lookup, user
 * creation UI + CSV import). Postgres also enforces it with a unique index on
 * lower(email) (migration 0008) — this helper is the application-side half.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/email.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts tests/lib/email.test.ts
git commit -m "feat(auth): shared normalizeEmail helper"
```

---

### Task 2: In-memory login rate limiter

**Files:**
- Create: `src/server/auth/rate-limit.ts`
- Test: `tests/server/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/rate-limit.test.ts
import { beforeEach, describe, expect, it } from 'vitest'

import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  clearLoginFailures,
  isRateLimited,
  loginRateLimitKey,
  recordLoginFailure,
  resetLoginRateLimiter,
} from '@/server/auth/rate-limit'

const KEY = loginRateLimitKey('203.0.113.7', 'camille@aps.fr')
const T0 = 1_750_000_000_000

beforeEach(() => {
  resetLoginRateLimiter()
})

describe('loginRateLimitKey', () => {
  it('combines ip and email', () => {
    expect(KEY).toBe('203.0.113.7|camille@aps.fr')
  })
})

describe('login rate limiter', () => {
  it('allows attempts below the threshold', () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) recordLoginFailure(KEY, T0 + i)
    expect(isRateLimited(KEY, T0 + 1000)).toBe(false)
  })

  it('blocks after LOGIN_MAX_FAILURES failures inside the window', () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure(KEY, T0 + i)
    expect(isRateLimited(KEY, T0 + 1000)).toBe(true)
  })

  it('unblocks once the window has elapsed', () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure(KEY, T0 + i)
    expect(isRateLimited(KEY, T0 + LOGIN_WINDOW_MS + 10)).toBe(false)
  })

  it('clearLoginFailures resets the counter (successful login)', () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure(KEY, T0 + i)
    clearLoginFailures(KEY)
    expect(isRateLimited(KEY, T0 + 1000)).toBe(false)
  })

  it('keys are independent (different ip or email)', () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure(KEY, T0 + i)
    expect(isRateLimited(loginRateLimitKey('203.0.113.8', 'camille@aps.fr'), T0 + 1000)).toBe(false)
    expect(isRateLimited(loginRateLimitKey('203.0.113.7', 'autre@aps.fr'), T0 + 1000)).toBe(false)
  })

  it('a failure outside the window does not count toward the threshold', () => {
    recordLoginFailure(KEY, T0)
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) {
      recordLoginFailure(KEY, T0 + LOGIN_WINDOW_MS + 100 + i)
    }
    expect(isRateLimited(KEY, T0 + LOGIN_WINDOW_MS + 1000)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/rate-limit.test.ts`
Expected: FAIL — cannot resolve `@/server/auth/rate-limit`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/auth/rate-limit.ts
/**
 * Limiteur de tentatives de connexion EN MÉMOIRE (anti credential-stuffing).
 *
 * Hypothèse assumée : l'app tourne en mono-container (Dokploy) — pas de Redis.
 * Limitation documentée : le compteur se réinitialise au redéploiement, ce qui
 * est acceptable pour ralentir une attaque online (argon2id protège le reste).
 *
 * Clé = `ip|email normalisé`. Au-delà de LOGIN_MAX_FAILURES échecs dans la
 * fenêtre glissante, `authorize` rejette sans toucher ni la DB ni argon2.
 */

export const LOGIN_MAX_FAILURES = 5
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
/** Au-delà de cette taille, recordLoginFailure balaie les entrées expirées. */
const SWEEP_THRESHOLD = 1000

const failures = new Map<string, number[]>()

export function loginRateLimitKey(ip: string, normalizedEmail: string): string {
  return `${ip}|${normalizedEmail}`
}

/** Timestamps encore dans la fenêtre ; nettoie l'entrée au passage. */
function liveTimestamps(key: string, now: number): number[] {
  const stamps = failures.get(key)
  if (!stamps) return []
  const live = stamps.filter((t) => now - t < LOGIN_WINDOW_MS)
  if (live.length === 0) failures.delete(key)
  else if (live.length !== stamps.length) failures.set(key, live)
  return live
}

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  return liveTimestamps(key, now).length >= LOGIN_MAX_FAILURES
}

export function recordLoginFailure(key: string, now: number = Date.now()): void {
  if (failures.size >= SWEEP_THRESHOLD) {
    for (const k of [...failures.keys()]) liveTimestamps(k, now)
  }
  failures.set(key, [...liveTimestamps(key, now), now])
}

/** À appeler sur login réussi. */
export function clearLoginFailures(key: string): void {
  failures.delete(key)
}

/** Réservé aux tests. */
export function resetLoginRateLimiter(): void {
  failures.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/rate-limit.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/rate-limit.ts tests/server/rate-limit.test.ts
git commit -m "feat(auth): in-memory login rate limiter"
```

---

### Task 3: Harden `authorize` (rate-limit, timing oracle, normalization, projection, password max)

**Files:**
- Modify: `src/server/auth.ts`
- Test: `tests/server/authorize.test.ts` (new)

The provider's `authorize` is currently an inline closure — extract it as an exported
function so it can be unit-tested, exactly like `nodeJwtCallback` already is.

- [ ] **Step 1: Write the failing test**

Before writing it, open `tests/server/auth-jwt-callback.test.ts` and reuse its
mocking style for `@/server/db` (the module under test imports the db singleton;
that file already solves AUTH_SECRET + db mocking for `auth.ts`). The test below
assumes `vi.mock('@/server/db')` works the same way; adapt the mock plumbing to
match the existing file if it differs, WITHOUT changing the assertions.

```ts
// tests/server/authorize.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubEnv('AUTH_SECRET', 'test-secret')

const selectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
}
vi.mock('@/server/db', () => ({
  db: { select: vi.fn(() => selectChain) },
}))

const verifyPassword = vi.fn()
const hashPassword = vi.fn(async () => '$argon2id$dummy')
vi.mock('@/server/auth/password', () => ({
  verifyPassword: (...args: unknown[]) => verifyPassword(...args),
  hashPassword: (...args: unknown[]) => hashPassword(...args),
}))

import { authorizeCredentials } from '@/server/auth'
import { LOGIN_MAX_FAILURES, resetLoginRateLimiter } from '@/server/auth/rate-limit'

const USER_ROW = {
  id: 'u1',
  email: 'camille@aps.fr',
  firstName: 'Camille',
  passwordHash: '$argon2id$real',
  role: 'employee' as const,
  storeId: 's1',
  passwordChangedAt: new Date('2026-01-01T00:00:00Z'),
}

function reqWithIp(ip: string): Request {
  return new Request('http://localhost/api/auth/callback/credentials', {
    headers: { 'x-forwarded-for': ip },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetLoginRateLimiter()
  selectChain.limit.mockResolvedValue([USER_ROW])
  verifyPassword.mockResolvedValue(true)
})

describe('authorizeCredentials', () => {
  it('logs in with a differently-cased, padded email (normalization)', async () => {
    const result = await authorizeCredentials(
      { email: '  Camille@APS.fr ', password: 'secret123' },
      reqWithIp('203.0.113.7'),
    )
    expect(result).toMatchObject({ id: 'u1', email: 'camille@aps.fr' })
    // The DB lookup received the normalized email.
    expect(selectChain.where).toHaveBeenCalled()
  })

  it('rejects a password longer than 128 chars without touching the db', async () => {
    const result = await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'x'.repeat(129) },
      reqWithIp('203.0.113.7'),
    )
    expect(result).toBeNull()
    expect(selectChain.limit).not.toHaveBeenCalled()
  })

  it('runs a dummy argon2 verify when the email is unknown (timing oracle)', async () => {
    selectChain.limit.mockResolvedValue([])
    const result = await authorizeCredentials(
      { email: 'inconnu@aps.fr', password: 'secret123' },
      reqWithIp('203.0.113.7'),
    )
    expect(result).toBeNull()
    expect(verifyPassword).toHaveBeenCalledTimes(1)
  })

  it('blocks the 6th attempt after 5 failures from the same ip+email', async () => {
    verifyPassword.mockResolvedValue(false)
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      await authorizeCredentials(
        { email: 'camille@aps.fr', password: 'wrong' },
        reqWithIp('203.0.113.7'),
      )
    }
    selectChain.limit.mockClear()
    const result = await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'wrong' },
      reqWithIp('203.0.113.7'),
    )
    expect(result).toBeNull()
    expect(selectChain.limit).not.toHaveBeenCalled() // rejected before the DB
  })

  it('a successful login clears the failure counter', async () => {
    verifyPassword.mockResolvedValue(false)
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) {
      await authorizeCredentials(
        { email: 'camille@aps.fr', password: 'wrong' },
        reqWithIp('203.0.113.7'),
      )
    }
    verifyPassword.mockResolvedValue(true)
    await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'right' },
      reqWithIp('203.0.113.7'),
    )
    verifyPassword.mockResolvedValue(false)
    // Counter was cleared: next failure is #1, not #5+1.
    const result = await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'wrong' },
      reqWithIp('203.0.113.7'),
    )
    expect(result).toBeNull()
    expect(selectChain.limit).toHaveBeenCalled() // still reaching the DB
  })

  it('a different ip is not blocked by another ip failures', async () => {
    verifyPassword.mockResolvedValue(false)
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      await authorizeCredentials(
        { email: 'camille@aps.fr', password: 'wrong' },
        reqWithIp('203.0.113.7'),
      )
    }
    verifyPassword.mockResolvedValue(true)
    const result = await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'right' },
      reqWithIp('198.51.100.9'),
    )
    expect(result).toMatchObject({ id: 'u1' })
  })

  it('missing x-forwarded-for falls back to a shared "unknown" bucket', async () => {
    const result = await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'secret123' },
      new Request('http://localhost/'),
    )
    expect(result).toMatchObject({ id: 'u1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/authorize.test.ts`
Expected: FAIL — `authorizeCredentials` is not exported.

- [ ] **Step 3: Implement in `src/server/auth.ts`**

Replace the `credentialsSchema`, add imports, extract `authorizeCredentials`,
and wire it into the provider. Full relevant section after edit:

```ts
import { normalizeEmail } from '@/lib/email'
import { hashPassword, verifyPassword } from './auth/password'
import {
  clearLoginFailures,
  isRateLimited,
  loginRateLimitKey,
  recordLoginFailure,
} from './auth/rate-limit'

const credentialsSchema = z.object({
  email: z.string().email(),
  // .max(128) borne le coût argon2 (DoS par mot de passe de plusieurs Mo).
  password: z.string().min(1).max(128),
})

// Hash factice vérifié quand l'email n'existe pas en base : le temps de
// réponse ne distingue plus « email inconnu » de « mot de passe faux »
// (oracle d'énumération). Jamais le hash d'un vrai mot de passe.
const dummyHashPromise: Promise<string> = hashPassword('timing-equalizer-dummy')

/**
 * Coeur de l'authentification credentials, exporté pour les tests (même
 * pattern que nodeJwtCallback). Rate-limit par ip|email AVANT tout travail
 * coûteux ; normalisation email ; projection explicite (jamais SELECT *).
 */
export async function authorizeCredentials(
  creds: unknown,
  request: Request | undefined,
) {
  const parsed = credentialsSchema.safeParse(creds)
  if (!parsed.success) return null
  const email = normalizeEmail(parsed.data.email)
  const { password } = parsed.data

  const ip =
    request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rlKey = loginRateLimitKey(ip, email)
  if (isRateLimited(rlKey)) return null

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      passwordHash: users.passwordHash,
      role: users.role,
      storeId: users.storeId,
      passwordChangedAt: users.passwordChangedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (!user) {
    await verifyPassword(await dummyHashPromise, password)
    recordLoginFailure(rlKey)
    return null
  }

  const ok = await verifyPassword(user.passwordHash, password)
  if (!ok) {
    recordLoginFailure(rlKey)
    return null
  }

  clearLoginFailures(rlKey)
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    role: user.role,
    storeId: user.storeId,
    passwordChangedAt: user.passwordChangedAt.getTime(),
  }
}
```

And in the `NextAuth({ ... providers: [...] })` block:

```ts
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: authorizeCredentials,
    }),
  ],
```

Note: Auth.js v5 passes `(credentials, request)` to `authorize` — the signature
matches directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/authorize.test.ts tests/server/auth-jwt-callback.test.ts`
Expected: PASS (the existing jwt-callback tests must stay green).

- [ ] **Step 5: Commit**

```bash
git add src/server/auth.ts tests/server/authorize.test.ts
git commit -m "feat(auth): rate-limited authorize with timing-oracle fix and email normalization"
```

---

### Task 4: Normalize email at user creation (UI + CSV import)

**Files:**
- Modify: `src/lib/admin/prepare-user.ts`
- Test: `tests/server/admin-prep.test.ts` (extend)

`prepareUserInsert` is the single funnel for BOTH `users.create` and
`users.bulkCreate` (CSV import) — normalizing here covers both paths.

- [ ] **Step 1: Add the failing test**

Append to the existing `describe` in `tests/server/admin-prep.test.ts`:

```ts
it('normalizes the email (trim + lowercase)', () => {
  const insert = prepareUserInsert(
    { email: '  Camille@APS.fr ', firstName: 'Camille', role: 'employee', storeId: null },
    'hash',
  )
  expect(insert.email).toBe('camille@aps.fr')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/admin-prep.test.ts`
Expected: FAIL — receives `'  Camille@APS.fr '`.

- [ ] **Step 3: Implement**

In `src/lib/admin/prepare-user.ts`:

```ts
import { normalizeEmail } from '@/lib/email'

export function prepareUserInsert(input: PrepareUserInput, hash: string): UserInsert {
  return {
    email: normalizeEmail(input.email),
    firstName: input.firstName,
    role: input.role,
    storeId: input.storeId ?? null,
    passwordHash: hash,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/admin-prep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/prepare-user.ts tests/server/admin-prep.test.ts
git commit -m "feat(admin): normalize emails at user creation (UI + CSV import)"
```

---

### Task 5: Migration 0008 — email lowercase + unique lower(email) + UNIQUE stores.name

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `drizzle/0008_*.sql` (generated then hand-edited)

No unit test (DDL). Verified by boot if Docker is available, else at prod boot
(established project policy — flag it in the PR description).

- [ ] **Step 1: Update the Drizzle schema**

In `src/server/db/schema.ts`:

1. Add `uniqueIndex` to the existing `drizzle-orm/pg-core` import list, and add
   a new import: `import { sql } from 'drizzle-orm'`.
2. `stores.name` becomes unique:

```ts
  name: text('name').notNull().unique(),
```

3. `users` gets a third argument (functional unique index — defense in depth on
   top of application-side normalizeEmail), matching the object style already
   used by `chatQueries`:

```ts
export const users = pgTable('users', {
  // ... colonnes existantes inchangées ...
}, (t) => ({
  emailLowerIdx: uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
}))
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/0008_<name>.sql` containing
`CREATE UNIQUE INDEX "users_email_lower_idx" ...` and
`ALTER TABLE "stores" ADD CONSTRAINT "stores_name_unique" UNIQUE("name");`
(exact wording may vary; verify both statements are present).

- [ ] **Step 3: Hand-edit the migration — prepend the data normalization**

At the TOP of the generated `drizzle/0008_*.sql`, before any other statement:

```sql
UPDATE "users" SET "email" = lower(trim("email"));--> statement-breakpoint
```

Politique fail-loud assumée : si deux emails ne diffèrent que par la casse (ou
deux stores partagent un nom), la migration échoue au boot — résolution
manuelle puis redeploy (cas jugé improbable, documenté dans la spec).

- [ ] **Step 4: Verify against a local database if Docker is available**

Run: `docker start formaps_postgres 2>$null; npm run db:migrate`
Expected: migration applies cleanly (local dev db on port 5433).
If Docker Desktop is not running, SKIP — note "0008 to be applied at prod boot"
for the PR description, per project policy.

- [ ] **Step 5: Run the full suite (schema change can ripple)**

Run: `npm test`
Expected: PASS (437+ tests, plus those added by Tasks 1-4).

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(db): migration 0008 — lowercase emails, unique lower(email), unique stores.name"
```

---

### Task 6: Refresh JWT claims role/storeId on every session read

**Files:**
- Modify: `src/server/auth/token-validation.ts`
- Modify: `src/server/auth.ts` (nodeJwtCallback)
- Test: `tests/server/token-validation.test.ts` (update — return type changes)
- Test: `tests/server/auth-jwt-callback.test.ts` (update + extend)

- [ ] **Step 1: Update token-validation tests for the new return shape**

`validatePasswordFreshness` now returns an object. In
`tests/server/token-validation.test.ts`, update every assertion
`toBe('fresh')` → `toMatchObject({ status: 'fresh' })` and
`toBe('stale')` → `toEqual({ status: 'stale' })`, then ADD:

```ts
it('returns fresh claims (role, storeId) alongside the status', async () => {
  // Arrange the existing db mock so the row is:
  // { passwordChangedAt: <matching date>, role: 'admin', storeId: 'store-9' }
  const result = await validatePasswordFreshness(
    { sub: 'u1', passwordChangedAt: MATCHING_EPOCH_MS },
    mockDb,
  )
  expect(result).toEqual({
    status: 'fresh',
    claims: { role: 'admin', storeId: 'store-9' },
  })
})

it('fail-open on db error returns fresh WITHOUT claims', async () => {
  // Arrange the existing db mock to reject.
  const result = await validatePasswordFreshness(
    { sub: 'u1', passwordChangedAt: 123 },
    failingDb,
  )
  expect(result).toEqual({ status: 'fresh' })
})
```

(Adapt mock variable names — `mockDb`, `MATCHING_EPOCH_MS`, `failingDb` — to
the helpers that already exist in that file; the row projection mock must now
include `role` and `storeId`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/token-validation.test.ts`
Expected: FAIL — function still returns `'fresh' | 'stale'` strings.

- [ ] **Step 3: Implement the new return shape**

Replace `validatePasswordFreshness` in `src/server/auth/token-validation.ts`:

```ts
export type FreshnessResult =
  | { status: 'stale' }
  | { status: 'fresh'; claims?: { role: 'employee' | 'admin'; storeId: string | null } }

/**
 * Reads the user's current passwordChangedAt (staleness check) AND role/storeId
 * (claim refresh — a demoted admin loses the console at the NEXT request, not
 * at re-login) in the same single SELECT. DB errors fail OPEN ('fresh', no
 * claims → existing token claims are kept) so a transient Postgres outage never
 * logs the whole portal out.
 */
export async function validatePasswordFreshness(
  token: FreshnessToken,
  dbClient: Db,
): Promise<FreshnessResult> {
  if (!token.sub) return { status: 'stale' }
  try {
    const [row] = await dbClient
      .select({
        passwordChangedAt: users.passwordChangedAt,
        role: users.role,
        storeId: users.storeId,
      })
      .from(users)
      .where(eq(users.id, token.sub))
      .limit(1)
    if (isTokenStale(token.passwordChangedAt, row?.passwordChangedAt ?? null)) {
      return { status: 'stale' }
    }
    return { status: 'fresh', claims: { role: row!.role, storeId: row!.storeId } }
  } catch (err) {
    console.error('[auth] vérification passwordChangedAt a échoué (fail-open):', err)
    return { status: 'fresh' }
  }
}
```

(`isTokenStale` is unchanged.)

- [ ] **Step 4: Update nodeJwtCallback in `src/server/auth.ts`**

```ts
export const nodeJwtCallback: JwtCallback = async (params) => {
  if (params.user) {
    return authConfig.callbacks.jwt(params)
  }
  const freshness = await validatePasswordFreshness(params.token, db)
  if (freshness.status === 'stale') {
    return null
  }
  // Réécrit les claims avec les valeurs DB fraîches : une rétrogradation ou un
  // changement de magasin prend effet à la requête suivante. Fail-open (pas de
  // claims) ⇒ on garde les claims existants du token.
  if (freshness.claims) {
    params.token.role = freshness.claims.role
    params.token.storeId = freshness.claims.storeId
  }
  return params.token
}
```

- [ ] **Step 5: Extend `tests/server/auth-jwt-callback.test.ts`**

Update existing mocks of `validatePasswordFreshness` (or of the db row) to the
new shape, then ADD:

```ts
it('rewrites role and storeId on the token from fresh db claims', async () => {
  // Arrange: db row → { passwordChangedAt: matching, role: 'employee', storeId: 'store-2' }
  const token = { sub: 'u1', passwordChangedAt: MATCHING_EPOCH_MS, role: 'admin', storeId: 'store-1' }
  const result = await nodeJwtCallback({ token } as never)
  expect(result).toMatchObject({ role: 'employee', storeId: 'store-2' })
})

it('keeps existing claims when freshness fails open without claims', async () => {
  // Arrange: db mock rejects (fail-open path).
  const token = { sub: 'u1', passwordChangedAt: 123, role: 'admin', storeId: 'store-1' }
  const result = await nodeJwtCallback({ token } as never)
  expect(result).toMatchObject({ role: 'admin', storeId: 'store-1' })
})
```

(Same remark: adapt to that file's existing mock helpers.)

- [ ] **Step 6: Run all auth tests**

Run: `npx vitest run tests/server/token-validation.test.ts tests/server/auth-jwt-callback.test.ts tests/server/authorize.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/auth/token-validation.ts src/server/auth.ts tests/server/token-validation.test.ts tests/server/auth-jwt-callback.test.ts
git commit -m "feat(auth): refresh role/storeId JWT claims on every session read"
```

---

### Task 7: Session maxAge 7 days

**Files:**
- Modify: `src/server/auth.config.ts`
- Modify: `src/server/auth.ts` (remove the duplicate session block)
- Test: `tests/server/auth-config.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/auth-config.test.ts
import { describe, expect, it } from 'vitest'

import authConfig from '@/server/auth.config'

describe('authConfig.session', () => {
  it('uses JWT strategy with a 7-day maxAge', () => {
    expect(authConfig.session).toEqual({
      strategy: 'jwt',
      maxAge: 7 * 24 * 60 * 60,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/auth-config.test.ts`
Expected: FAIL — no `maxAge`.

- [ ] **Step 3: Implement**

In `src/server/auth.config.ts`:

```ts
  session: {
    strategy: 'jwt',
    // 7 jours (défaut Auth.js = 30 j). Les claims role/storeId étant rafraîchis
    // à chaque requête (token-validation.ts), c'est une 2e ligne de défense.
    maxAge: 7 * 24 * 60 * 60,
  },
```

In `src/server/auth.ts`, DELETE the line `session: { strategy: 'jwt' },` inside
the `NextAuth({ ... })` call — it would override the shared config's `maxAge`
(the `...authConfig` spread already carries the session block).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/server/auth-config.test.ts tests/server/authorize.test.ts tests/server/auth-jwt-callback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth.config.ts src/server/auth.ts tests/server/auth-config.test.ts
git commit -m "feat(auth): explicit 7-day session maxAge in shared config"
```

---

### Task 8: Last-admin guard on users.update

**Files:**
- Modify: `src/server/trpc/routers/admin.ts` (users.update, ~l.215)
- Test: `tests/server/admin-users-guard.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Open `tests/server/admin-users-password.test.ts` first and copy its
caller/ctx mock plumbing (it already builds an admin caller around the users
router). Assertions to implement:

```ts
// tests/server/admin-users-guard.test.ts
// (mock plumbing copied from admin-users-password.test.ts — db mock must
// support: select role of target, count admins, update chain)
import { describe, expect, it } from 'vitest'

describe('admin.users.update — garde dernier admin', () => {
  it('refuse la rétrogradation de soi-même (FORBIDDEN)', async () => {
    // caller authenticated as admin id 'admin-1'
    await expect(
      caller.users.update({ id: 'admin-1', role: 'employee' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('refuse la rétrogradation du dernier admin (FORBIDDEN)', async () => {
    // target 'admin-2' is admin, db admin count = 1
    await expect(
      caller.users.update({ id: 'admin-2', role: 'employee' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('autorise la rétrogradation quand il reste un autre admin', async () => {
    // target 'admin-2' is admin, db admin count = 2, update returns a row
    const result = await caller.users.update({ id: 'admin-2', role: 'employee' })
    expect(result).toMatchObject({ id: 'admin-2' })
  })

  it("rétrograder un employé (no-op rôle) ne déclenche pas la garde", async () => {
    // target 'emp-1' role employee, count query must NOT run
    const result = await caller.users.update({ id: 'emp-1', role: 'employee' })
    expect(result).toMatchObject({ id: 'emp-1' })
  })

  it('un update sans champ role ne déclenche aucune des deux requêtes de garde', async () => {
    const result = await caller.users.update({ id: 'admin-2', firstName: 'Léa' })
    expect(result).toMatchObject({ id: 'admin-2' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/admin-users-guard.test.ts`
Expected: FAIL — no FORBIDDEN thrown.

- [ ] **Step 3: Implement**

In `src/server/trpc/routers/admin.ts`: add `count` to the drizzle-orm import
(`import { asc, count, desc, eq, like, max } from 'drizzle-orm'`), then at the
top of the `update` mutation body:

```ts
  update: adminProcedure.input(userUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, password, ...rest } = input

    if (rest.role === 'employee') {
      if (id === ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Impossible de se rétrograder soi-même.',
        })
      }
      const [target] = await ctx.db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
      if (target?.role === 'admin') {
        // Fenêtre de course admin↔admin assumée sans transaction : deux demotes
        // strictement simultanés sont irréalistes sur ce produit interne.
        const [admins] = await ctx.db
          .select({ n: count() })
          .from(users)
          .where(eq(users.role, 'admin'))
        if ((admins?.n ?? 0) <= 1) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Il doit rester au moins un administrateur.',
          })
        }
      }
    }

    // ... reste de la mutation inchangé (fields, hash password, update) ...
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/server/admin-users-guard.test.ts tests/server/admin-users-password.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/admin.ts tests/server/admin-users-guard.test.ts
git commit -m "feat(admin): forbid self-demotion and demoting the last admin"
```

---

### Task 9: tRPC errorFormatter (mask internal errors)

**Files:**
- Create: `src/server/trpc/error-format.ts`
- Modify: `src/server/trpc/trpc.ts`
- Test: `tests/server/trpc-error-format.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/trpc-error-format.test.ts
import { describe, expect, it } from 'vitest'

import { maskInternalErrorMessage } from '@/server/trpc/error-format'

const baseShape = {
  message: 'relation "users" does not exist',
  code: -32603,
  data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'progress.markDone' },
}

describe('maskInternalErrorMessage', () => {
  it('replaces the message of INTERNAL_SERVER_ERROR shapes', () => {
    const masked = maskInternalErrorMessage(baseShape)
    expect(masked.message).toBe('Une erreur interne est survenue.')
    expect(masked.data).toEqual(baseShape.data) // reste intact
  })

  it('leaves business errors untouched (CONFLICT)', () => {
    const shape = {
      ...baseShape,
      message: 'Email déjà utilisé',
      data: { ...baseShape.data, code: 'CONFLICT', httpStatus: 409 },
    }
    expect(maskInternalErrorMessage(shape)).toBe(shape)
  })

  it('leaves zod BAD_REQUEST untouched', () => {
    const shape = {
      ...baseShape,
      message: 'Invalid input',
      data: { ...baseShape.data, code: 'BAD_REQUEST', httpStatus: 400 },
    }
    expect(maskInternalErrorMessage(shape)).toBe(shape)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/trpc-error-format.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/server/trpc/error-format.ts
/**
 * Masque le message des erreurs internes (500) côté client : sans formatter,
 * tRPC renvoie `error.message` brut même en prod (texte Postgres, noms de
 * tables...). Les erreurs métier (UNAUTHORIZED, FORBIDDEN, CONFLICT, zod
 * BAD_REQUEST...) passent inchangées — l'UI admin s'appuie dessus.
 */
export const INTERNAL_ERROR_MESSAGE = 'Une erreur interne est survenue.'

export function maskInternalErrorMessage<S extends { message: string; data: { code: string } }>(
  shape: S,
): S {
  if (shape.data.code !== 'INTERNAL_SERVER_ERROR') return shape
  return { ...shape, message: INTERNAL_ERROR_MESSAGE }
}
```

In `src/server/trpc/trpc.ts`:

```ts
import { maskInternalErrorMessage } from './error-format'

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    if (shape.data.code === 'INTERNAL_SERVER_ERROR') {
      // Le détail reste visible côté serveur (logs Dokploy), jamais côté client.
      console.error('[trpc] erreur interne masquée au client:', error)
    }
    return maskInternalErrorMessage(shape)
  },
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/server/trpc-error-format.test.ts && npm test`
Expected: PASS — full suite too (router tests asserting on error messages of
CONFLICT/NOT_FOUND must be unaffected; if a test asserted on an internal 500
message, update it to expect `INTERNAL_ERROR_MESSAGE`).

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/error-format.ts src/server/trpc/trpc.ts tests/server/trpc-error-format.test.ts
git commit -m "feat(trpc): errorFormatter masks internal error messages from clients"
```

---

### Task 10: Automated GDPR purge of chat_queries

**Files:**
- Create: `src/server/jobs/purge-chat-queries.ts`
- Create: `src/instrumentation.ts`
- Modify: `docker-compose.yml` (env mapping)
- Modify: `docs/DEPLOY.md` (purge section)
- Test: `tests/server/purge-chat-queries.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/purge-chat-queries.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_RETENTION_MONTHS,
  PURGE_INTERVAL_MS,
  purgeChatQueries,
  retentionCutoff,
  retentionMonths,
} from '@/server/jobs/purge-chat-queries'

describe('retentionMonths', () => {
  it('defaults to 12 when the env is unset', () => {
    expect(retentionMonths(undefined)).toBe(DEFAULT_RETENTION_MONTHS)
    expect(DEFAULT_RETENTION_MONTHS).toBe(12)
  })

  it('parses a valid integer', () => {
    expect(retentionMonths('6')).toBe(6)
  })

  it('falls back to 12 on invalid values (warn, never throw)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(retentionMonths('abc')).toBe(12)
    expect(retentionMonths('0')).toBe(12)
    expect(retentionMonths('-3')).toBe(12)
    expect(retentionMonths('2.5')).toBe(12)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('retentionCutoff', () => {
  it('subtracts N months from now', () => {
    const now = new Date('2026-06-11T10:00:00Z')
    expect(retentionCutoff(12, now).toISOString()).toBe('2025-06-11T10:00:00.000Z')
  })
})

describe('purgeChatQueries', () => {
  function mockDb(returned: Array<{ id: string }>) {
    const returning = vi.fn().mockResolvedValue(returned)
    const where = vi.fn(() => ({ returning }))
    const del = vi.fn(() => ({ where }))
    return { db: { delete: del } as never, del, where }
  }

  it('deletes rows older than the cutoff and returns the count', async () => {
    const { db, del } = mockDb([{ id: 'a' }, { id: 'b' }])
    const n = await purgeChatQueries(db, 12)
    expect(n).toBe(2)
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('returns 0 when nothing matched', async () => {
    const { db } = mockDb([])
    expect(await purgeChatQueries(db, 12)).toBe(0)
  })
})

describe('startChatQueriesPurgeJob', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs at boot, re-runs every 24h, and never throws on db error', async () => {
    // Fresh module instance so the `started` latch is clean.
    const { startChatQueriesPurgeJob } = await import('@/server/jobs/purge-chat-queries')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const returning = vi.fn().mockRejectedValue(new Error('db down'))
    const db = { delete: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })) } as never

    startChatQueriesPurgeJob(db)
    await vi.runOnlyPendingTimersAsync() // flush the boot run microtasks
    expect(returning).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled() // logged, not thrown

    await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS)
    expect(returning).toHaveBeenCalledTimes(2)

    // Idempotent: a second start does not double the schedule.
    startChatQueriesPurgeJob(db)
    await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS)
    expect(returning).toHaveBeenCalledTimes(3)
    error.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/purge-chat-queries.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the job module**

```ts
// src/server/jobs/purge-chat-queries.ts
import { lt } from 'drizzle-orm'

import type { db } from '@/server/db'
import { chatQueries } from '@/server/db/schema'

/**
 * Purge RGPD automatisée de `chat_queries` (questions BRAIN = texte libre
 * potentiellement personnel — voir docs/DEPLOY.md). Lancée au boot par
 * src/instrumentation.ts puis toutes les 24 h. Rétention par défaut 12 mois,
 * configurable via CHAT_QUERIES_RETENTION_MONTHS (mappée dans le compose).
 */

type Db = typeof db

export const DEFAULT_RETENTION_MONTHS = 12
export const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000

export function retentionMonths(
  raw: string | undefined = process.env.CHAT_QUERIES_RETENTION_MONTHS,
): number {
  if (!raw) return DEFAULT_RETENTION_MONTHS
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    console.warn(
      `[rgpd] CHAT_QUERIES_RETENTION_MONTHS invalide (« ${raw} ») — défaut ${DEFAULT_RETENTION_MONTHS} mois`,
    )
    return DEFAULT_RETENTION_MONTHS
  }
  return n
}

export function retentionCutoff(months: number, now: Date = new Date()): Date {
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - months)
  return cutoff
}

/** Supprime les requêtes plus vieilles que la rétention ; retourne le nombre. */
export async function purgeChatQueries(
  dbClient: Db,
  months: number = retentionMonths(),
): Promise<number> {
  const deleted = await dbClient
    .delete(chatQueries)
    .where(lt(chatQueries.createdAt, retentionCutoff(months)))
    .returning({ id: chatQueries.id })
  return deleted.length
}

let started = false

/** Boot + toutes les 24 h. Idempotent ; les erreurs DB sont loggées, jamais levées. */
export function startChatQueriesPurgeJob(dbClient: Db): void {
  if (started) return
  started = true
  const run = async () => {
    try {
      const n = await purgeChatQueries(dbClient)
      console.log(`[rgpd] purge chat_queries : ${n} ligne(s) supprimée(s)`)
    } catch (err) {
      console.error('[rgpd] purge chat_queries échouée (retentée au prochain cycle) :', err)
    }
  }
  void run()
  // unref(): le timer ne retient pas le process à l'arrêt (SIGTERM propre).
  setInterval(run, PURGE_INTERVAL_MS).unref()
}
```

- [ ] **Step 4: Create the instrumentation hook**

```ts
// src/instrumentation.ts
/**
 * Next.js instrumentation hook — runs ONCE at server start (Node runtime
 * only; never during build, never on Edge). Dynamic imports keep the db
 * driver out of any non-Node bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const [{ db }, { startChatQueriesPurgeJob }] = await Promise.all([
    import('@/server/db'),
    import('@/server/jobs/purge-chat-queries'),
  ])
  startChatQueriesPurgeJob(db)
}
```

- [ ] **Step 5: Map the env in docker-compose.yml**

In the `web.environment` block, after the `FAQ_RELEVANCE_THRESHOLD` line:

```yaml
      # Rétention RGPD de chat_queries en mois (vide → défaut 12 dans le code).
      CHAT_QUERIES_RETENTION_MONTHS: ${CHAT_QUERIES_RETENTION_MONTHS:-}
```

- [ ] **Step 6: Update docs/DEPLOY.md**

In the « Données & purge (RGPD) » section, replace the bullet « La purge
**n'est pas encore automatisée** — ... » with:

```markdown
- La purge est **automatisée depuis la PR sécurité (2026-06-11)** : au boot du
  conteneur web puis toutes les 24 h (`src/instrumentation.ts` →
  `src/server/jobs/purge-chat-queries.ts`). Rétention configurable via
  `CHAT_QUERIES_RETENTION_MONTHS` (défaut 12 mois).
- Filet manuel si besoin (mêmes effets que le job) :
```

(keep the existing SQL block underneath as the manual fallback).

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/server/purge-chat-queries.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/jobs/purge-chat-queries.ts src/instrumentation.ts docker-compose.yml docs/DEPLOY.md tests/server/purge-chat-queries.test.ts
git commit -m "feat(rgpd): automated chat_queries purge (boot + daily, 12-month retention)"
```

---

### Task 11: HTTP security headers

**Files:**
- Modify: `next.config.ts`
- Test: `tests/lib/next-config-headers.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/next-config-headers.test.ts
import { describe, expect, it } from 'vitest'

import nextConfig from '../../next.config'

describe('next.config security headers', () => {
  it('disables the X-Powered-By header', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it('applies the safe header set to every route', async () => {
    const rules = await nextConfig.headers!()
    expect(rules).toHaveLength(1)
    expect(rules[0].source).toBe('/(.*)')
    const byKey = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))
    expect(byKey).toEqual({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/next-config-headers.test.ts`
Expected: FAIL — `poweredByHeader` undefined.

- [ ] **Step 3: Implement**

Replace `next.config.ts` content:

```ts
import type { NextConfig } from "next";

// Set « sûr » sans CSP (décision spec 2026-06-11) : app interne authentifiée,
// HTML sanitisé par sanitize-html ; une CSP (même Report-Only) reste un
// follow-up possible. HSTS est laissé à Traefik (terminaison TLS).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Build a self-contained server (.next/standalone) for the Docker runner image.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Run tests + build smoke**

Run: `npx vitest run tests/lib/next-config-headers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add next.config.ts tests/lib/next-config-headers.test.ts
git commit -m "feat(security): HTTP security headers + poweredByHeader off"
```

---

### Task 12: Schema hardening — password max, sharepointUrl scheme

**Files:**
- Modify: `src/lib/admin/schemas.ts`
- Modify: `src/lib/account/schemas.ts`
- Test: `tests/lib/admin-schemas-hardening.test.ts` (new)
- Test: `tests/lib/account-schemas.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/admin-schemas-hardening.test.ts
import { describe, expect, it } from 'vitest'

import {
  formationCreateSchema,
  formationUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@/lib/admin/schemas'

const BASE_FORMATION = {
  name: 'F', slug: 'f', tag: 't', icon: 'i', description: 'd',
  kind: 'sharepoint' as const,
}

describe('password .max(128)', () => {
  it('userCreateSchema rejects >128 chars', () => {
    const result = userCreateSchema.safeParse({
      email: 'a@aps.fr', firstName: 'A', role: 'employee',
      password: 'x'.repeat(129),
    })
    expect(result.success).toBe(false)
  })

  it('userUpdateSchema rejects >128 chars', () => {
    const result = userUpdateSchema.safeParse({
      id: '5f0c1bba-cccc-4444-8888-aaaaaaaaaaaa',
      password: 'x'.repeat(129),
    })
    expect(result.success).toBe(false)
  })

  it('still accepts a 128-char password', () => {
    const result = userUpdateSchema.safeParse({
      id: '5f0c1bba-cccc-4444-8888-aaaaaaaaaaaa',
      password: 'x'.repeat(128),
    })
    expect(result.success).toBe(true)
  })
})

describe('sharepointUrl scheme', () => {
  it('rejects javascript: URLs (create + update)', () => {
    expect(
      formationCreateSchema.safeParse({
        ...BASE_FORMATION,
        sharepointUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false)
    expect(
      formationUpdateSchema.safeParse({
        id: '5f0c1bba-cccc-4444-8888-aaaaaaaaaaaa',
        sharepointUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false)
  })

  it('accepts https and keeps null/undefined passthrough', () => {
    expect(
      formationCreateSchema.safeParse({
        ...BASE_FORMATION,
        sharepointUrl: 'https://aps.sharepoint.com/x',
      }).success,
    ).toBe(true)
    expect(
      formationCreateSchema.safeParse({ ...BASE_FORMATION, sharepointUrl: null }).success,
    ).toBe(true)
    expect(formationCreateSchema.safeParse(BASE_FORMATION).success).toBe(true)
  })
})
```

And append to `tests/lib/account-schemas.test.ts`:

```ts
it('rejects a newPassword longer than 128 chars', () => {
  const result = changePasswordSchema.safeParse({
    currentPassword: 'old',
    newPassword: 'x'.repeat(129),
  })
  expect(result.success).toBe(false)
})

it('rejects a currentPassword longer than 128 chars (argon2 input bound)', () => {
  const result = changePasswordSchema.safeParse({
    currentPassword: 'x'.repeat(129),
    newPassword: 'newpassword1',
  })
  expect(result.success).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/admin-schemas-hardening.test.ts tests/lib/account-schemas.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

In `src/lib/admin/schemas.ts`, add a shared schema near the top:

```ts
/**
 * `z.string().url()` ne filtre PAS le scheme (vérifié à l'audit : un
 * `javascript:alert(1)` passe) — le refine borne aux liens http(s), rendus
 * en <a href> côté employé.
 */
const sharepointUrlSchema = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'URL http(s) requise')

/** Borne le coût argon2 (le hash d'une entrée de plusieurs Mo bloque le worker). */
const passwordSchema = z.string().min(8).max(128)
```

Then replace:
- in `formationFields`: `sharepointUrl: sharepointUrlSchema.nullable().optional(),`
- in `formationUpdateSchema`: `sharepointUrl: sharepointUrlSchema.nullable().optional(),`
- in `userCreateSchema`: `password: passwordSchema,`
- in `userUpdateSchema`: `password: passwordSchema.optional(),`

In `src/lib/account/schemas.ts`:

```ts
export const changePasswordSchema = z.object({
  // .max(128) borne l'entrée argon2 (vérif ET hash) — voir admin/schemas.ts.
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
})
```

- [ ] **Step 4: Run the affected suites**

Run: `npx vitest run tests/lib/admin-schemas-hardening.test.ts tests/lib/account-schemas.test.ts tests/server/admin-users-password.test.ts tests/server/account-password.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/schemas.ts src/lib/account/schemas.ts tests/lib/admin-schemas-hardening.test.ts tests/lib/account-schemas.test.ts
git commit -m "feat(security): password length bound and https-only sharepointUrl"
```

---

### Task 13: Cache-Control on the PDF download route

**Files:**
- Modify: `src/app/api/documents/[docId]/download/route.ts`
- Test: `tests/server/download-route.test.ts` (extend)

- [ ] **Step 1: Add the failing test**

In `tests/server/download-route.test.ts`, locate the existing happy-path test
(authenticated GET returning 200) and add alongside it, reusing the same
mocks/arrangement:

```ts
it('serves PDFs with private no-store cache headers and nosniff', async () => {
  // same arrangement as the existing 200 test
  const res = await GET(makeRequest('http://localhost/api/documents/doc-1/download'), {
    params: Promise.resolve({ docId: 'doc-1' }),
  })
  expect(res.status).toBe(200)
  expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
})
```

(Adapt `makeRequest`/mock names to that file's existing helpers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/download-route.test.ts`
Expected: FAIL — headers absent.

- [ ] **Step 3: Implement**

In the final `Response` of the route:

```ts
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${wantsDownload ? 'attachment' : 'inline'}; filename="${safeName}.pdf"`,
      // Document authentifié : jamais en cache partagé ni sur disque proxy.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/server/download-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documents/[docId]/download/route.ts tests/server/download-route.test.ts
git commit -m "feat(security): private no-store cache headers on PDF downloads"
```

---

### Task 14: Final verification and PR

**Files:** none new.

- [ ] **Step 1: Full gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: 0 warnings, 0 type errors, all tests green (437 + ~30 new).

- [ ] **Step 2: Production build smoke (placeholders env, same as CI)**

Run: `npm run build`
Expected: build succeeds (catches `headers()`/instrumentation config issues).
If the build needs env placeholders, reuse the exact env vars from
`.github/workflows/ci.yml`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/security-hardening
gh pr create --title "Security hardening (audit 2026-06-09 — PR ⑥)" --body "$(cat <<'EOF'
## Contenu
- Rate-limit login en mémoire (5 échecs / 15 min par ip|email) + suppression du timing oracle (dummy argon2 verify)
- Normalisation email trim+lowercase (authorize + création UI + import CSV) + migration 0008 (lower(trim(email)) + index unique lower(email) + UNIQUE stores.name)
- Claims JWT role/storeId rafraîchis à chaque requête (même SELECT que passwordChangedAt)
- Session maxAge 7 jours (config partagée)
- Garde dernier admin / self-demote sur users.update
- errorFormatter tRPC : messages internes masqués au client
- Purge RGPD automatisée de chat_queries (boot + 24h, rétention 12 mois, env CHAT_QUERIES_RETENTION_MONTHS mappée compose)
- Headers HTTP (XFO, nosniff, Referrer-Policy, Permissions-Policy) + poweredByHeader off
- Durcissements : password .max(128), sharepointUrl https-only, Cache-Control private/no-store sur les PDF

## ⚠️ Déploiement
- Migration 0008 fail-loud si emails dupliqués par casse ou stores.name dupliqués — vérifier les logs Dokploy
- Les sessions existantes ne sont PAS invalidées ; les nouveaux logins prennent le maxAge 7 j
- Un mot de passe >128 caractères (improbable) ne peut plus se connecter → reset admin

Spec : docs/superpowers/specs/2026-06-11-security-hardening-design.md
Audit : docs/reviews/2026-06-09-full-code-review.md (PR ⑥)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Watch CI**

Run: `gh pr checks --watch`
Expected: `checks` green. Ne JAMAIS merger avec une CI rouge.

---

## Self-review notes

- Spec coverage: §1→T2+T3, §2→T1+T4+T5, §3→T6, §4→T7, §5→T8, §6→T9, §7→T10,
  §8→T11, §9→T3 (credentialsSchema max) + T12 + T5 (stores.name) + T13. Complete.
- Type consistency: `FreshnessResult` (T6) consumed by `nodeJwtCallback` (T6);
  `normalizeEmail` (T1) used in T3/T4; rate-limit API names match between T2 and T3.
- Existing tests expected to need updates: `token-validation.test.ts`,
  `auth-jwt-callback.test.ts` (return-shape change, planned in T6). Any test
  asserting raw 500 messages must switch to `INTERNAL_ERROR_MESSAGE` (T9 step 4).
