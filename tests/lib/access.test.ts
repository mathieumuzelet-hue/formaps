import { decideAccess } from '@/lib/access'
import { expect, test } from 'vitest'

test('non connecté hors /connexion → login', () => {
  expect(decideAccess({ path: '/', isLoggedIn: false, role: null })).toBe('redirect-login')
})
test('/connexion public', () => {
  expect(decideAccess({ path: '/connexion', isLoggedIn: false, role: null })).toBe('allow')
})
test('connecté qui va sur /connexion → home', () => {
  expect(decideAccess({ path: '/connexion', isLoggedIn: true, role: 'employee' })).toBe('redirect-home')
})
test('employé sur /admin → home', () => {
  expect(decideAccess({ path: '/admin/magasins', isLoggedIn: true, role: 'employee' })).toBe('redirect-home')
})
test('admin sur /admin → allow', () => {
  expect(decideAccess({ path: '/admin/magasins', isLoggedIn: true, role: 'admin' })).toBe('allow')
})
test('connecté sur page normale → allow', () => {
  expect(decideAccess({ path: '/formations', isLoggedIn: true, role: 'employee' })).toBe('allow')
})
