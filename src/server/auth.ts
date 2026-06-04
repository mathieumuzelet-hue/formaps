import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import authConfig from './auth.config'
import { db } from './db'
import { users } from './db/schema'
import { verifyPassword } from './auth/password'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

/**
 * Node-runtime Auth.js instance. This is the ONLY place the Credentials
 * provider lives, because `authorize` touches the database (postgres driver)
 * and argon2 (native), neither of which can run on the Edge. Middleware must
 * NOT import this module — it imports `auth.config.ts` instead.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: 'jwt' },
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
        }
      },
    }),
  ],
})
