/**
 * Pure CSV mapping/validation helpers for bulk import of stores and users.
 *
 * No server imports — this module is shared with the client (browser preview of
 * a parsed CSV) and with the tRPC bulk mutations. Parsing of the raw CSV text is
 * done elsewhere (papaparse in the browser); here we only map and validate the
 * already-parsed records (array of string→string maps).
 */

export type RowError = { row: number; message: string }
export type StoreInput = { name: string; basculeDate: string; currentStep: number }
export type UserInput = {
  email: string
  firstName: string
  role: 'employee' | 'admin'
  storeName: string | null
}

/**
 * Normalize a CSV header: lowercase, strip accents, trim, collapse runs of
 * whitespace into single underscores. So "Date Bascule" → "date_bascule".
 */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
}

/** Build a normalized-key map from a raw record. */
function normalizeRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    out[normalizeHeader(key)] = value
  }
  return out
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Basic email shape: something@something.tld
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseStoreRows(records: Array<Record<string, string>>): {
  valid: Array<{ row: number; data: StoreInput }>
  errors: RowError[]
} {
  const valid: Array<{ row: number; data: StoreInput }> = []
  const errors: RowError[] = []

  records.forEach((record, index) => {
    const row = index + 1
    const r = normalizeRecord(record)

    const name = (r.nom ?? '').trim()
    if (!name) {
      errors.push({ row, message: 'Le nom du magasin est requis.' })
      return
    }

    const basculeDate = (r.date_bascule ?? '').trim()
    if (!DATE_RE.test(basculeDate)) {
      errors.push({ row, message: 'La date de bascule doit être au format AAAA-MM-JJ.' })
      return
    }

    let currentStep = 0
    const rawEtape = (r.etape ?? '').trim()
    if (rawEtape !== '') {
      const parsed = Number(rawEtape)
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 4) {
        errors.push({ row, message: "L'étape doit être un entier entre 0 et 4." })
        return
      }
      currentStep = parsed
    }

    valid.push({ row, data: { name, basculeDate, currentStep } })
  })

  return { valid, errors }
}

export function parseUserRows(records: Array<Record<string, string>>): {
  valid: Array<{ row: number; data: UserInput }>
  errors: RowError[]
} {
  const valid: Array<{ row: number; data: UserInput }> = []
  const errors: RowError[] = []

  records.forEach((record, index) => {
    const row = index + 1
    const r = normalizeRecord(record)

    const email = (r.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      errors.push({ row, message: "L'adresse email est invalide ou manquante." })
      return
    }

    const firstName = (r.prenom ?? '').trim()
    if (!firstName) {
      errors.push({ row, message: 'Le prénom est requis.' })
      return
    }

    let role: 'employee' | 'admin' = 'employee'
    const rawRole = (r.role ?? '').trim().toLowerCase()
    if (rawRole !== '') {
      if (rawRole !== 'employee' && rawRole !== 'admin') {
        errors.push({ row, message: "Le rôle doit être 'employee' ou 'admin'." })
        return
      }
      role = rawRole
    }

    const rawMagasin = (r.magasin ?? '').trim()
    const storeName = rawMagasin === '' ? null : rawMagasin

    valid.push({ row, data: { email, firstName, role, storeName } })
  })

  return { valid, errors }
}

/**
 * Resolve a store name (as written in the CSV) to a store id using a map keyed
 * by the normalized store name. Returns `undefined` when not found. Kept pure so
 * the bulk-user mutation's resolution logic is unit-testable without a DB.
 */
export function resolveStoreId(
  storeIdByName: Map<string, string>,
  storeName: string | null,
): string | null | undefined {
  if (storeName === null) return null
  return storeIdByName.get(normalizeHeader(storeName))
}
