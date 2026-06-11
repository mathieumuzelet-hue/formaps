import { beforeEach, describe, expect, it, vi } from 'vitest'

// Plomberie alignée sur auth-jwt-callback.test.ts : vi.hoisted + mocks de
// @/server/db et @/server/auth/password, AUTH_SECRET posé AVANT l'import
// dynamique (auth.ts jette à l'import sans lui).
const { selectChain, verifyPassword, hashPassword } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  }
  return {
    selectChain,
    verifyPassword: vi.fn(),
    hashPassword: vi.fn(async () => '$argon2id$dummy'),
  }
})

vi.mock('@/server/db', () => ({
  db: { select: vi.fn(() => selectChain) },
}))

// argon2 est natif et inutile ici — on neutralise le module password.
vi.mock('@/server/auth/password', () => ({
  verifyPassword,
  hashPassword,
}))

process.env.AUTH_SECRET = 'test-secret'
const { authorizeCredentials } = await import('@/server/auth')
const { LOGIN_MAX_FAILURES, resetLoginRateLimiter } = await import(
  '@/server/auth/rate-limit'
)

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
    expect(selectChain.where).toHaveBeenCalled()
  })

  it('cased/padded and canonical emails share the same rate-limit bucket', async () => {
    // Test porteur pour normalizeEmail : sans normalisation, les 5 échecs
    // sur '  CAMILLE@APS.fr ' iraient dans un bucket distinct et la tentative
    // canonique atteindrait la DB. (Le mock db ignore le where, donc seul le
    // partage de bucket prouve la normalisation.)
    verifyPassword.mockResolvedValue(false)
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      await authorizeCredentials(
        { email: '  CAMILLE@APS.fr ', password: 'wrong' },
        reqWithIp('203.0.113.7'),
      )
    }
    selectChain.limit.mockClear()
    const result = await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'wrong' },
      reqWithIp('203.0.113.7'),
    )
    expect(result).toBeNull()
    expect(selectChain.limit).not.toHaveBeenCalled() // blocked BEFORE the DB
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
    // Le hash factice (hashPassword mocké → '$argon2id$dummy') est bien celui
    // passé à verifyPassword, pas un hash réel ni une valeur vide.
    expect(verifyPassword).toHaveBeenCalledWith('$argon2id$dummy', 'secret123')
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
    // 4 échecs → succès → 1 échec : sans clearLoginFailures, ce 5e échec
    // CUMULÉ bloquerait la tentative suivante. Avec le clear, le compteur
    // est reparti à 1 et la tentative suivante atteint encore la DB.
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
    await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'wrong' },
      reqWithIp('203.0.113.7'),
    )
    selectChain.limit.mockClear()
    const result = await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'wrong' },
      reqWithIp('203.0.113.7'),
    )
    expect(result).toBeNull()
    expect(selectChain.limit).toHaveBeenCalled() // counter restarted at 1, not 5
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

  it('missing x-forwarded-for still authenticates (unknown ip bucket)', async () => {
    const result = await authorizeCredentials(
      { email: 'camille@aps.fr', password: 'secret123' },
      new Request('http://localhost/'),
    )
    expect(result).toMatchObject({ id: 'u1' })
  })
})
