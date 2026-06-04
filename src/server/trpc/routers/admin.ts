import { asc, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { formations, stores, users } from '@/server/db/schema'
import { hashPassword } from '@/server/auth/password'
import { prepareUserInsert } from '@/lib/admin/prepare-user'
import { stripPassword } from '@/lib/admin/sanitize-user'
import {
  formationCreateSchema,
  formationUpdateSchema,
  storeUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@/lib/admin/schemas'
import { adminProcedure, router } from '../trpc'

// Re-export so existing imports of the schema from the router keep working.
export { storeUpdateSchema }

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505'

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  )
}

const storesRouter = router({
  /** All stores ordered by name. */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(stores).orderBy(asc(stores.name))
  }),

  update: adminProcedure.input(storeUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, ...fields } = input
    const [row] = await ctx.db
      .update(stores)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(stores.id, id))
      .returning()

    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
    return row
  }),
})

const formationsRouter = router({
  /** All formations ordered by `order`. */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(formations).orderBy(asc(formations.order))
  }),

  create: adminProcedure.input(formationCreateSchema).mutation(async ({ ctx, input }) => {
    try {
      const [row] = await ctx.db.insert(formations).values(input).returning()
      return row
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Slug déjà utilisé' })
      }
      throw err
    }
  }),

  update: adminProcedure.input(formationUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, ...fields } = input
    try {
      const [row] = await ctx.db
        .update(formations)
        .set(fields)
        .where(eq(formations.id, id))
        .returning()

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      return row
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Slug déjà utilisé' })
      }
      throw err
    }
  }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(formations).where(eq(formations.id, input.id))
      return { id: input.id }
    }),
})

const usersRouter = router({
  /** All users, explicit columns — NEVER selects `passwordHash`. */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        role: users.role,
        storeId: users.storeId,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.email))
  }),

  create: adminProcedure.input(userCreateSchema).mutation(async ({ ctx, input }) => {
    const hash = await hashPassword(input.password)
    const insert = prepareUserInsert(input, hash)
    try {
      const [row] = await ctx.db.insert(users).values(insert).returning()
      return stripPassword(row)
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Email déjà utilisé' })
      }
      throw err
    }
  }),

  update: adminProcedure.input(userUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, password, ...rest } = input

    const fields: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (password !== undefined) {
      fields.passwordHash = await hashPassword(password)
    }

    const [row] = await ctx.db
      .update(users)
      .set(fields)
      .where(eq(users.id, id))
      .returning()

    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
    return stripPassword(row)
  }),
})

export const adminRouter = router({
  stores: storesRouter,
  formations: formationsRouter,
  users: usersRouter,
})
