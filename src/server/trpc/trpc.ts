import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'

import { auth } from '@/server/auth'
import { db } from '@/server/db'

/**
 * Build the per-request tRPC context. Resolves the Auth.js session (Node
 * runtime — touches the JWT/cookies) and exposes the Drizzle `db` handle.
 *
 * `headers` is accepted so HTTP callers (the fetch route handler) and the RSC
 * server caller can both feed request context in; `auth()` reads the cookies
 * from the ambient request, so we don't thread `headers` through manually.
 */
export async function createTRPCContext(_opts: { headers: Headers }) {
  return {
    session: await auth(),
    db,
  }
}

type Context = Awaited<ReturnType<typeof createTRPCContext>>

const t = initTRPC.context<Context>().create({ transformer: superjson })

export const router = t.router
export const createCallerFactory = t.createCallerFactory
export const publicProcedure = t.procedure

/**
 * Procedure requiring an authenticated session. Narrows `ctx.session` /
 * `ctx.user` to non-null for downstream resolvers.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({
    ctx: {
      session: ctx.session,
      user: ctx.session.user,
      db: ctx.db,
    },
  })
})

/**
 * Procedure requiring an authenticated admin. Extends `protectedProcedure`.
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN' })
  }
  return next({ ctx })
})
