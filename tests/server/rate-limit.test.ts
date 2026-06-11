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
