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

test('rejette un nouveau mdp de plus de 128 caractères', () => {
  expect(
    changePasswordSchema.safeParse({
      currentPassword: 'ancien123',
      newPassword: 'x'.repeat(129),
    }).success,
  ).toBe(false)
})

test('rejette un mdp actuel de plus de 128 caractères (borne entrée argon2)', () => {
  expect(
    changePasswordSchema.safeParse({
      currentPassword: 'x'.repeat(129),
      newPassword: 'nouveau-mdp-1',
    }).success,
  ).toBe(false)
})
