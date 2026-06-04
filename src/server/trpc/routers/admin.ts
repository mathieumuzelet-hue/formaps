import fs from 'node:fs/promises'
import path from 'node:path'

import { asc, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { formationDocuments, formations, stores, users } from '@/server/db/schema'
import { hashPassword } from '@/server/auth/password'
import { generatePassword } from '@/server/auth/generate-password'
import { prepareUserInsert } from '@/lib/admin/prepare-user'
import { stripPassword } from '@/lib/admin/sanitize-user'
import {
  normalizeHeader,
  parseStoreRows,
  parseUserRows,
  resolveStoreId,
  type RowError,
} from '@/lib/admin/csv-import'
import {
  formationCreateSchema,
  formationUpdateSchema,
  storeCreateSchema,
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

/** Input shape for bulk-import mutations: parsed CSV rows (string→string maps). */
const bulkImportSchema = z.array(z.record(z.string(), z.string())).max(2000)

const storesRouter = router({
  /** All stores ordered by name. */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(stores).orderBy(asc(stores.name))
  }),

  create: adminProcedure.input(storeCreateSchema).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db.insert(stores).values(input).returning()
    return row
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

  /**
   * Bulk-create stores from parsed CSV rows. Parse errors and per-row DB errors
   * are collected and returned alongside the count of successfully created rows.
   */
  bulkCreate: adminProcedure.input(bulkImportSchema).mutation(async ({ ctx, input }) => {
    const { valid, errors } = parseStoreRows(input)
    const allErrors: RowError[] = [...errors]
    let created = 0

    for (const { row, data } of valid) {
      try {
        await ctx.db.insert(stores).values(data)
        created += 1
      } catch (err) {
        if (isUniqueViolation(err)) {
          allErrors.push({ row, message: `Magasin déjà existant : ${data.name}` })
        } else {
          allErrors.push({ row, message: "Erreur d'insertion en base." })
        }
      }
    }

    return { created, errors: allErrors }
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
      const [row] = await ctx.db
        .delete(formations)
        .where(eq(formations.id, input.id))
        .returning()

      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Formation introuvable' })
      return { id: input.id }
    }),

  /** Documents PDF d'une formation, ordonnés par `order`. */
  documentsByFormation: adminProcedure
    .input(z.object({ formationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(formationDocuments)
        .where(eq(formationDocuments.formationId, input.formationId))
        .orderBy(asc(formationDocuments.order))
    }),

  /** Supprime un document : ligne DB puis fichier sur le volume (unlink). */
  deleteDocument: adminProcedure
    .input(z.object({ docId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(formationDocuments)
        .where(eq(formationDocuments.id, input.docId))
        .returning()

      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document introuvable' })

      const dir = process.env.UPLOADS_DIR || '/app/uploads'
      await fs.rm(path.join(dir, `${input.docId}.pdf`), { force: true })

      return { docId: input.docId }
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

  /**
   * Bulk-create users from parsed CSV rows. Each user gets a server-generated
   * password; only its argon2 hash is stored, while the plaintext is returned in
   * the result so the admin can distribute credentials. Store names are resolved
   * to ids against the existing stores; unknown names are reported per row.
   */
  bulkCreate: adminProcedure.input(bulkImportSchema).mutation(async ({ ctx, input }) => {
    const { valid, errors } = parseUserRows(input)
    const allErrors: RowError[] = [...errors]
    const created: Array<{ row: number; email: string; firstName: string; password: string }> = []

    // Build a name→id map once for store resolution.
    const storeRows = await ctx.db
      .select({ id: stores.id, name: stores.name })
      .from(stores)
    const storeIdByName = new Map<string, string>()
    for (const s of storeRows) {
      storeIdByName.set(normalizeHeader(s.name), s.id)
    }

    for (const { row, data } of valid) {
      const storeId = resolveStoreId(storeIdByName, data.storeName)
      if (storeId === undefined) {
        allErrors.push({ row, message: `Magasin "${data.storeName}" introuvable` })
        continue
      }

      const password = generatePassword()
      const passwordHash = await hashPassword(password)
      const insert = prepareUserInsert(
        { email: data.email, firstName: data.firstName, role: data.role, storeId },
        passwordHash,
      )

      try {
        await ctx.db.insert(users).values(insert)
        created.push({ row, email: data.email, firstName: data.firstName, password })
      } catch (err) {
        if (isUniqueViolation(err)) {
          allErrors.push({ row, message: `Email déjà utilisé : ${data.email}` })
        } else {
          allErrors.push({ row, message: "Erreur d'insertion en base." })
        }
      }
    }

    return { created, errors: allErrors }
  }),
})

export const adminRouter = router({
  stores: storesRouter,
  formations: formationsRouter,
  users: usersRouter,
})
