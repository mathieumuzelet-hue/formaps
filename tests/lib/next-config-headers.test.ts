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
      'Strict-Transport-Security': 'max-age=31536000',
    })
  })
})
