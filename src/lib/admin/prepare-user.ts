import { normalizeEmail } from '@/lib/email'

/**
 * Pure helper that builds the DB insert object for a new user. The plaintext
 * password is NEVER carried into the returned object — only the precomputed
 * argon2 `hash` lands in `passwordHash`. Keeping this pure lets us unit-test
 * the "no plaintext leak" invariant without touching the database.
 * The email is normalized (trim + lowercase) so both the UI create path and
 * the CSV bulk import write the canonical form the authorize lookup expects.
 */
export type PrepareUserInput = {
  email: string
  firstName: string
  role: 'employee' | 'admin'
  storeId?: string | null
}

export type UserInsert = {
  email: string
  firstName: string
  role: 'employee' | 'admin'
  storeId: string | null
  passwordHash: string
}

export function prepareUserInsert(input: PrepareUserInput, hash: string): UserInsert {
  return {
    email: normalizeEmail(input.email),
    firstName: input.firstName,
    role: input.role,
    storeId: input.storeId ?? null,
    passwordHash: hash,
  }
}
