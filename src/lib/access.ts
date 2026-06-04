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
  // The login page is public; a logged-in user landing there goes home.
  if (path === LOGIN_PATH) {
    return isLoggedIn ? 'redirect-home' : 'allow'
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
