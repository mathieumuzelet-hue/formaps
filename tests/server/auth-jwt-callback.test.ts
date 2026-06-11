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
// hashPassword doit résoudre une promesse : auth.ts chaîne .catch() dessus
// au chargement du module (dummyHashPromise).
vi.mock('@/server/auth/password', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(async () => '$argon2id$dummy'),
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
