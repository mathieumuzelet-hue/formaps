import { expect, test } from 'vitest'

import { prepareUserInsert } from '@/lib/admin/prepare-user'
import { stripPassword } from '@/lib/admin/sanitize-user'
import { storeCreateSchema, storeUpdateSchema } from '@/lib/admin/schemas'

const UUID = '11111111-1111-4111-8111-111111111111'

test('prepareUserInsert sets passwordHash and drops the plaintext password', () => {
  const obj = prepareUserInsert(
    { email: 'a@b.fr', firstName: 'Léa', role: 'admin', storeId: UUID },
    'HASHED',
  )
  expect(obj.passwordHash).toBe('HASHED')
  expect(obj).not.toHaveProperty('password')
  expect(obj.storeId).toBe(UUID)
})

test('prepareUserInsert defaults storeId to null when absent', () => {
  const obj = prepareUserInsert(
    { email: 'a@b.fr', firstName: 'Léa', role: 'employee' },
    'HASHED',
  )
  expect(obj.storeId).toBeNull()
})

test('stripPassword removes passwordHash from a user row', () => {
  const user = {
    id: UUID,
    email: 'a@b.fr',
    firstName: 'Léa',
    role: 'admin' as const,
    storeId: null,
    passwordHash: 'SECRET',
  }
  const out = stripPassword(user)
  expect(out).not.toHaveProperty('passwordHash')
  expect(out.email).toBe('a@b.fr')
})

test('storeUpdateSchema rejects currentStep out of range', () => {
  expect(storeUpdateSchema.safeParse({ id: UUID, currentStep: 9 }).success).toBe(false)
})

test('storeUpdateSchema accepts currentStep within range', () => {
  expect(storeUpdateSchema.safeParse({ id: UUID, currentStep: 3 }).success).toBe(true)
})

test('storeCreateSchema rejects currentStep out of range', () => {
  expect(
    storeCreateSchema.safeParse({ name: 'Lille', basculeDate: '2026-06-01', currentStep: 9 })
      .success,
  ).toBe(false)
})

test('storeCreateSchema rejects an empty name', () => {
  expect(
    storeCreateSchema.safeParse({ name: '', basculeDate: '2026-06-01', currentStep: 2 }).success,
  ).toBe(false)
})

test('storeCreateSchema accepts a valid store', () => {
  expect(
    storeCreateSchema.safeParse({ name: 'Lille', basculeDate: '2026-06-01', currentStep: 2 })
      .success,
  ).toBe(true)
})
