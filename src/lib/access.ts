export type Decision = 'allow' | 'redirect-login' | 'redirect-home'

export type Role = 'employee' | 'admin'

export interface AccessInput {
  path: string
  isLoggedIn: boolean
  role: Role | null
}

/** Public login route. */
export const LOGIN_PATH = '/connexion'

/**
 * Pure access-control decision shared by middleware (edge) and tests.
 * Keeps NO Next.js / db / argon2 dependency so it stays edge-safe.
 */
export function decideAccess({ path, isLoggedIn, role }: AccessInput): Decision {
  // The login page is ALWAYS reachable, even with a session cookie. The Edge
  // middleware only verifies the JWT signature — it cannot check password
  // freshness (no DB on Edge), so a stale-but-signed token looks "logged in"
  // here. Bouncing such users home caused an infinite / ↔ /connexion loop
  // (prod incident 2026-06-06): the Node layer killed the session and sent
  // them back to /connexion forever. The "already logged in → home" bounce
  // now lives in the connexion page itself, Node-side, where freshness IS
  // known.
  if (path === LOGIN_PATH) {
    return 'allow'
  }

  // Everything else requires a session.
  if (!isLoggedIn) {
    return 'redirect-login'
  }

  // Admin area is admin-only.
  if (path.startsWith('/admin') && role !== 'admin') {
    return 'redirect-home'
  }

  return 'allow'
}
