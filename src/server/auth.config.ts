import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-safe Auth.js configuration.
 *
 * This module is imported by BOTH `auth.ts` (Node runtime) and `middleware.ts`
 * (Edge runtime). It must therefore NEVER import argon2, the postgres driver,
 * or anything else that cannot run on the Edge. The `providers` array is empty
 * here on purpose — the Credentials provider (which does the db lookup +
 * argon2 verify) is added in `auth.ts`, which only runs on Node.
 */
export const authConfig = {
  // Behind a reverse proxy (Traefik/Dokploy), Auth.js must trust the forwarded
  // host or it throws UntrustedHost. This config is shared by BOTH the Node
  // instance (auth.ts) AND the Edge middleware, so trustHost must live HERE —
  // setting it only in auth.ts left the middleware rejecting the host, which
  // broke the session and caused a / ↔ /connexion redirect loop.
  trustHost: true,
  pages: {
    signIn: '/connexion',
  },
  session: {
    strategy: 'jwt',
  },
  providers: [],
  callbacks: {
    // Persist app-specific claims onto the JWT at sign-in time. `user` is only
    // present on the initial sign-in; on subsequent calls the token already
    // carries the data.
    jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.storeId = user.storeId
        token.firstName = user.firstName
        token.passwordChangedAt = user.passwordChangedAt
      }
      return token
    },
    // Expose the claims we stashed on the token to the session object that
    // server components / middleware read.
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? ''
        session.user.role = token.role
        session.user.storeId = token.storeId
        session.user.firstName = token.firstName
      }
      return session
    },
  },
} satisfies NextAuthConfig

export default authConfig
