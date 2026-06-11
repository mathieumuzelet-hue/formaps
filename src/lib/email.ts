/**
 * Canonical email form used by EVERY read/write path (authorize lookup, user
 * creation UI + CSV import). Postgres also enforces it with a unique index on
 * lower(email) (migration 0008) — this helper is the application-side half.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
