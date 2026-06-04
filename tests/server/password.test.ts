import { hashPassword, verifyPassword } from '@/server/auth/password'
import { expect, test } from 'vitest'

test('hash + verify round-trip', async () => {
  const h = await hashPassword('s3cret!')
  expect(await verifyPassword(h, 's3cret!')).toBe(true)
  expect(await verifyPassword(h, 'wrong')).toBe(false)
})

test('verifyPassword returns false on malformed hash', async () => {
  expect(await verifyPassword('not-a-valid-hash', 's3cret!')).toBe(false)
})
