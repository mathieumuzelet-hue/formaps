import NextAuth from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import authConfig from './auth.config'
import { normalizeEmail } from '@/lib/email'
import { db } from './db'
import { users } from './db/schema'
import { hashPassword, verifyPassword } from './auth/password'
import {
  clearLoginFailures,
  isRateLimited,
  loginRateLimitKey,
  recordLoginFailure,
} from './auth/rate-limit'
import { validatePasswordFreshness } from './auth/token-validation'

// Fail loud at import time (Node runtime only) if the signing secret is absent,
// mirroring how `db/index.ts` throws on a missing DATABASE_URL. The Edge
// middleware imports `auth.config.ts`, not this module, so it stays unaffected.
if (!process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET manquant — requis pour Auth.js')
}

const credentialsSchema = z.object({
  // .trim() AVANT .email() : un email collé avec des espaces (copier-coller)
  // doit passer la validation ; normalizeEmail canonise ensuite (lowercase).
  // .max(254) = borne RFC 5321 d'une adresse, appliquée APRÈS trim.
  email: z.string().trim().max(254).email(),
  // .max(128) borne le coût argon2 (DoS par mot de passe de plusieurs Mo).
  password: z.string().min(1).max(128),
})

// Hash factice vérifié quand l'email n'existe pas en base : le temps de
// réponse ne distingue plus « email inconnu » de « mot de passe faux »
// (oracle d'énumération). Jamais le hash d'un vrai mot de passe.
const dummyHashPromise: Promise<string> = hashPassword('timing-equalizer-dummy').catch(
  () => '$argon2id$boot-fallback-invalid', // verifyPassword(garbage) => false, jamais de throw
)

/**
 * Coeur de l'authentification credentials, exporté pour les tests (même
 * pattern que nodeJwtCallback). Rate-limit par ip|email AVANT tout travail
 * coûteux ; normalisation email ; projection explicite (jamais SELECT *).
 */
export async function authorizeCredentials(
  creds: unknown,
  request: Request | undefined,
) {
  const parsed = credentialsSchema.safeParse(creds)
  if (!parsed.success) return null
  const email = normalizeEmail(parsed.data.email)
  const { password } = parsed.data

  // Derrière EXACTEMENT un proxy de confiance (Traefik, qui réécrit
  // x-forwarded-for), le dernier élément est l'IP posée par le proxy — le
  // premier deviendrait contrôlable par le client si un CDN s'ajoutait devant.
  const forwarded = request?.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',').at(-1)?.trim() || 'unknown'
  const rlKey = loginRateLimitKey(ip, email)
  if (isRateLimited(rlKey)) return null

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      passwordHash: users.passwordHash,
      role: users.role,
      storeId: users.storeId,
      passwordChangedAt: users.passwordChangedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (!user) {
    await verifyPassword(await dummyHashPromise, password)
    recordLoginFailure(rlKey)
    return null
  }

  const ok = await verifyPassword(user.passwordHash, password)
  if (!ok) {
    recordLoginFailure(rlKey)
    return null
  }

  clearLoginFailures(rlKey)
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    role: user.role,
    storeId: user.storeId,
    passwordChangedAt: user.passwordChangedAt.getTime(),
  }
}

type JwtCallback = NonNullable<NonNullable<NextAuthConfig['callbacks']>['jwt']>

/**
 * Node-side jwt callback. At sign-in it delegates to the shared (edge-safe)
 * callback that stamps the claims. On every subsequent session read it kills
 * the token (return null → Auth.js invalidates the session) when the password
 * changed since the token was issued, and refreshes role/storeId from the DB.
 * DB errors fail open — see token-validation.ts.
 */
export const nodeJwtCallback: JwtCallback = async (params) => {
  if (params.user) {
    return authConfig.callbacks.jwt(params)
  }
  const freshness = await validatePasswordFreshness(params.token, db)
  if (freshness.status === 'stale') {
    return null
  }
  // Réécrit les claims avec les valeurs DB fraîches : une rétrogradation ou un
  // changement de magasin prend effet à la requête suivante. Fail-open (pas de
  // claims) ⇒ on garde les claims existants du token. Le cookie décodé côté
  // Edge peut être en retard (le middleware ne vérifie que la signature) ;
  // chaque contrôle admin faisant autorité est Node-side (layout admin,
  // adminProcedure, handlers /api/admin) et voit les claims réécrits.
  if (freshness.claims) {
    params.token.role = freshness.claims.role
    params.token.storeId = freshness.claims.storeId
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
      authorize: authorizeCredentials,
    }),
  ],
})
