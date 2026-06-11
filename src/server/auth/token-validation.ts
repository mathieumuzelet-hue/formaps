import { eq } from 'drizzle-orm'

import type { db } from '@/server/db'
import { users } from '@/server/db/schema'

/**
 * Password-freshness check backing JWT session invalidation.
 *
 * Tokens carry a `passwordChangedAt` claim (epoch ms) stamped at sign-in.
 * On every Node-side session read, the claim is compared to the DB value by
 * EXACT equality — any password change/reset bumps the column and kills every
 * token issued before it. `import type` keeps this module free of the db
 * singleton's import-time env requirements (tests inject a mock).
 */

type Db = typeof db

type FreshnessToken = {
  sub?: string
  passwordChangedAt?: number
}

/**
 * A token is stale when its claim is missing (token pre-dates this feature —
 * the whole fleet re-logs once at first deploy), when the user no longer
 * exists, or when the claim differs from the DB value.
 */
export function isTokenStale(tokenValue: number | undefined, dbValue: Date | null): boolean {
  if (tokenValue === undefined) return true
  if (dbValue === null) return true
  return tokenValue !== dbValue.getTime()
}

export type FreshnessResult =
  | { status: 'stale' }
  | { status: 'fresh'; claims?: { role: 'employee' | 'admin'; storeId: string | null } }

/**
 * Reads the user's current passwordChangedAt (staleness check) AND role/storeId
 * (claim refresh — a demoted admin loses the console at the NEXT request, not
 * at re-login) in the same single SELECT. DB errors fail OPEN ('fresh', no
 * claims → existing token claims are kept) so a transient Postgres outage never
 * logs the whole portal out — the check is a hardening layer, not the primary
 * authentication (the JWT signature is).
 */
export async function validatePasswordFreshness(
  token: FreshnessToken,
  dbClient: Db,
): Promise<FreshnessResult> {
  if (!token.sub) return { status: 'stale' }
  try {
    const [row] = await dbClient
      .select({
        passwordChangedAt: users.passwordChangedAt,
        role: users.role,
        storeId: users.storeId,
      })
      .from(users)
      .where(eq(users.id, token.sub))
      .limit(1)
    // isTokenStale renvoie stale quand la row est absente : après ce garde,
    // row est nécessairement définie.
    if (!row || isTokenStale(token.passwordChangedAt, row.passwordChangedAt)) {
      return { status: 'stale' }
    }
    return { status: 'fresh', claims: { role: row.role, storeId: row.storeId } }
  } catch (err) {
    console.error('[auth] vérification passwordChangedAt a échoué (fail-open):', err)
    return { status: 'fresh' }
  }
}
