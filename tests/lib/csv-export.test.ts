import { expect, test } from 'vitest'

import { buildTemplateCsv, toCredentialsCsv, BOM } from '@/lib/admin/csv-export'

// --- buildTemplateCsv ---

test('buildTemplateCsv(stores): BOM + ; delimiter + header + example row', () => {
  const csv = buildTemplateCsv('stores')
  expect(csv.startsWith(BOM)).toBe(true)
  const body = csv.slice(BOM.length)
  const lines = body.split('\n')
  expect(lines[0]).toBe('nom;date_bascule;etape')
  expect(lines[1]).toBe('Magasin de Lille;2026-06-22;1')
  expect(lines).toHaveLength(2)
})

test('buildTemplateCsv(users): BOM + ; delimiter + header + example row', () => {
  const csv = buildTemplateCsv('users')
  expect(csv.startsWith(BOM)).toBe(true)
  const body = csv.slice(BOM.length)
  const lines = body.split('\n')
  expect(lines[0]).toBe('email;prenom;role;magasin')
  expect(lines[1]).toBe('camille.durand@apsuper.fr;Camille;employee;Magasin de Lille')
  expect(lines).toHaveLength(2)
})

// --- toCredentialsCsv ---

test('toCredentialsCsv: BOM + ; delimiter + header + one row per credential', () => {
  const csv = toCredentialsCsv([
    { email: 'a@b.fr', password: 'Abc123!x' },
    { email: 'c@d.fr', password: 'Zyx987!q' },
  ])
  expect(csv.startsWith(BOM)).toBe(true)
  const lines = csv.slice(BOM.length).split('\n')
  expect(lines[0]).toBe('email;mot_de_passe')
  expect(lines[1]).toBe('a@b.fr;Abc123!x')
  expect(lines[2]).toBe('c@d.fr;Zyx987!q')
  expect(lines).toHaveLength(3)
})

test('toCredentialsCsv: empty list yields header only', () => {
  const csv = toCredentialsCsv([])
  expect(csv).toBe(`${BOM}email;mot_de_passe`)
})

test("toCredentialsCsv: neutralise un email commençant par = (guard formule)", () => {
  const csv = toCredentialsCsv([{ email: '=evil@x.fr', password: 'Pass1234' }])
  expect(csv).toContain(`'=evil@x.fr;Pass1234`)
})

test('toCredentialsCsv: quote une cellule contenant le délimiteur', () => {
  const csv = toCredentialsCsv([{ email: 'a;b@x.fr', password: 'Pass1234' }])
  expect(csv).toContain('"a;b@x.fr";Pass1234')
})
