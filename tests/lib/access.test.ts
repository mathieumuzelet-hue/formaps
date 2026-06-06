import { decideAccess } from '@/lib/access'
import { expect, test } from 'vitest'

test('non connecté hors /connexion → login', () => {
  expect(decideAccess({ path: '/', isLoggedIn: false, role: null })).toBe('redirect-login')
})
test('/connexion public', () => {
  expect(decideAccess({ path: '/connexion', isLoggedIn: false, role: null })).toBe('allow')
})
test('connecté (vu de l’Edge) qui va sur /connexion → allow — JAMAIS redirect-home', () => {
  // Le middleware Edge ne vérifie que la signature du JWT, pas la fraîcheur
  // du mot de passe (pas de DB sur Edge). Un token périmé y passe pour
  // « connecté » : le renvoyer vers / créait une boucle infinie
  // / ↔ /connexion (incident prod 2026-06-06). Le bounce « déjà connecté →
  // home » est fait Node-side par la page connexion, qui sait, elle.
  expect(decideAccess({ path: '/connexion', isLoggedIn: true, role: 'employee' })).toBe('allow')
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
