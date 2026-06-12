import {
  MAX_IMPORT_ROWS,
  normalizeHeader,
  parseStoreRows,
  parseUserRows,
  resolveStoreId,
  sanitizeParsedRows,
} from '@/lib/admin/csv-import'
import { expect, test } from 'vitest'

test('normalizeHeader: lowercase, strip accents, collapse spaces', () => {
  expect(normalizeHeader('Date Bascule')).toBe('date_bascule')
  expect(normalizeHeader('  Nom  ')).toBe('nom')
  expect(normalizeHeader('DATE_BASCULE')).toBe('date_bascule')
  expect(normalizeHeader('Étape')).toBe('etape')
  expect(normalizeHeader('Prénom  du   client')).toBe('prenom_du_client')
})

// --- parseStoreRows ---

test('parseStoreRows: valid store row', () => {
  const res = parseStoreRows([
    { nom: 'Magasin de Lille', date_bascule: '2026-06-22', etape: '2' },
  ])
  expect(res.errors).toEqual([])
  expect(res.valid).toEqual([
    { row: 1, data: { name: 'Magasin de Lille', basculeDate: '2026-06-22', currentStep: 2 } },
  ])
})

test('parseStoreRows: missing nom → error, row skipped', () => {
  const res = parseStoreRows([{ nom: '  ', date_bascule: '2026-06-22' }])
  expect(res.valid).toEqual([])
  expect(res.errors).toHaveLength(1)
  expect(res.errors[0].row).toBe(1)
  expect(res.errors[0].message).toMatch(/nom/i)
})

test('parseStoreRows: bad date → error', () => {
  const res = parseStoreRows([{ nom: 'X', date_bascule: '22/06/2026' }])
  expect(res.valid).toEqual([])
  expect(res.errors).toHaveLength(1)
  expect(res.errors[0].message).toMatch(/date/i)
})

test('parseStoreRows: etape out of range → error', () => {
  const res = parseStoreRows([{ nom: 'X', date_bascule: '2026-06-22', etape: '7' }])
  expect(res.valid).toEqual([])
  expect(res.errors).toHaveLength(1)
  expect(res.errors[0].message).toMatch(/etape|étape/i)
})

test('parseStoreRows: etape defaults to 0 when absent', () => {
  const res = parseStoreRows([{ nom: 'X', date_bascule: '2026-06-22' }])
  expect(res.errors).toEqual([])
  expect(res.valid[0].data.currentStep).toBe(0)
})

test('parseStoreRows: tolerant headers (Nom, DATE_BASCULE)', () => {
  const res = parseStoreRows([
    { Nom: 'Tolérant', DATE_BASCULE: '2026-06-22', Étape: '1' },
  ])
  expect(res.errors).toEqual([])
  expect(res.valid[0].data).toEqual({
    name: 'Tolérant',
    basculeDate: '2026-06-22',
    currentStep: 1,
  })
})

test('parseStoreRows: row numbering is 1-based across multiple rows', () => {
  const res = parseStoreRows([
    { nom: 'A', date_bascule: '2026-06-22' },
    { nom: '', date_bascule: '2026-06-22' },
    { nom: 'C', date_bascule: '2026-06-22' },
  ])
  expect(res.valid.map((v) => v.row)).toEqual([1, 3])
  expect(res.errors[0].row).toBe(2)
})

// --- parseUserRows ---

test('parseUserRows: valid user row', () => {
  const res = parseUserRows([
    { email: 'JANE@EX.COM ', prenom: 'Jane', role: 'admin', magasin: 'Lille' },
  ])
  expect(res.errors).toEqual([])
  expect(res.valid).toEqual([
    { row: 1, data: { email: 'jane@ex.com', firstName: 'Jane', role: 'admin', storeName: 'Lille' } },
  ])
})

test('parseUserRows: bad email → error', () => {
  const res = parseUserRows([{ email: 'not-an-email', prenom: 'Bob' }])
  expect(res.valid).toEqual([])
  expect(res.errors).toHaveLength(1)
  expect(res.errors[0].message).toMatch(/email/i)
})

test('parseUserRows: missing prenom → error', () => {
  const res = parseUserRows([{ email: 'a@b.com', prenom: '' }])
  expect(res.valid).toEqual([])
  expect(res.errors[0].message).toMatch(/prenom|prénom/i)
})

test('parseUserRows: role defaults to employee', () => {
  const res = parseUserRows([{ email: 'a@b.com', prenom: 'Al' }])
  expect(res.errors).toEqual([])
  expect(res.valid[0].data.role).toBe('employee')
})

test('parseUserRows: invalid role → error', () => {
  const res = parseUserRows([{ email: 'a@b.com', prenom: 'Al', role: 'boss' }])
  expect(res.valid).toEqual([])
  expect(res.errors[0].message).toMatch(/role|rôle/i)
})

test('parseUserRows: magasin empty → storeName null', () => {
  const res = parseUserRows([{ email: 'a@b.com', prenom: 'Al', magasin: '   ' }])
  expect(res.errors).toEqual([])
  expect(res.valid[0].data.storeName).toBeNull()
})

// --- resolveStoreId ---

test('resolveStoreId: null storeName → null (no store)', () => {
  const map = new Map([['lille', 's1']])
  expect(resolveStoreId(map, null)).toBeNull()
})

test('resolveStoreId: resolves by normalized name (accents/case tolerant)', () => {
  const map = new Map([[normalizeHeader('Magasin de Lille'), 's1']])
  expect(resolveStoreId(map, 'MAGASIN DE LILLE')).toBe('s1')
  expect(resolveStoreId(map, 'Magasin de Lillé')).toBe('s1')
})

test('resolveStoreId: unknown name → undefined', () => {
  const map = new Map([['lille', 's1']])
  expect(resolveStoreId(map, 'Paris')).toBeUndefined()
})

// --- sanitizeParsedRows ---

test('sanitizeParsedRows: strip __parsed_extra (colonne en trop) et garde les colonnes connues', () => {
  const result = sanitizeParsedRows([
    { email: 'a@aps.fr', prenom: 'A', __parsed_extra: ['x'] } as never,
    { email: 'b@aps.fr', prenom: 'B' },
  ])
  expect(result).toEqual({
    rows: [
      { email: 'a@aps.fr', prenom: 'A' },
      { email: 'b@aps.fr', prenom: 'B' },
    ],
  })
})

test('sanitizeParsedRows: rejette un fichier de plus de MAX_IMPORT_ROWS lignes avec un message actionnable', () => {
  const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({
    email: `u${i}@aps.fr`,
  }))
  const result = sanitizeParsedRows(rows)
  expect('error' in result && result.error).toMatch(/200 lignes/)
})

test('sanitizeParsedRows: accepte exactement MAX_IMPORT_ROWS lignes', () => {
  const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({ email: `u${i}@aps.fr` }))
  const result = sanitizeParsedRows(rows)
  expect('rows' in result).toBe(true)
})
