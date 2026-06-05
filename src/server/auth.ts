import NextAuth from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import authConfig from './auth.config'
import { db } from './db'
import { users } from './db/schema'
import { verifyPassword } from './auth/password'
import { validatePasswordFreshness } from './auth/token-validation'

// Fail loud at import time (Node runtime only) if the signing secret is absent,
// mirroring how `db/index.ts` throws on a missing DATABASE_URL. The Edge
// middleware imports `auth.config.ts`, not this module, so it stays unaffected.
if (!process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET manquant — requis pour Auth.js')
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

type JwtCallback = NonNullable<NonNullable<NextAuthConfig['callbacks']>['jwt']>

/**
 * Node-side jwt callback. At sign-in it delegates to the shared (edge-safe)
 * callback that stamps the claims. On every subsequent session read it kills
 * the token (return null → Auth.js invalidates the session) when the password
 * changed since the token was issued. DB errors fail open — see
 * token-validation.ts.
 */
export const nodeJwtCallback: JwtCallback = async (params) => {
  if (params.user) {
    return authConfig.callbacks.jwt(params)
  }
  if ((await validatePasswordFreshness(params.token, db)) === 'stale') {
    return null
  }
  return params.token
}

/**
 * Node-runtime Auth.js instance. This is the ONLY place the Credentials
 * provider lives, because `authorize` touches the database (postgres driver)
 * and argon2 (native), neither of which can run on the Edge. Middleware must
 * NOT import this module — it imports `auth.config.ts` instead.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: 'jwt' },
  callbacks: {
    ...authConfig.callbacks,
    jwt: nodeJwtCallback,
  },
  // Required for self-hosting (non-Vercel) so Auth.js trusts the host header.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (creds) => {
        const parsed = credentialsSchema.safeParse(creds)
        if (!parsed.success) return null
        const { email, password } = parsed.data

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1)

        if (!user) return null

        const ok = await verifyPassword(user.passwordHash, password)
        if (!ok) return null

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          role: user.role,
          storeId: user.storeId,
          passwordChangedAt: user.passwordChangedAt.getTime(),
        }
      },
    }),
  ],
})
