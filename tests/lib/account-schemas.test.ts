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
