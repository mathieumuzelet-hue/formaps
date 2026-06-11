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
