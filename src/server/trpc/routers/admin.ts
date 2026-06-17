import fs from 'node:fs/promises'
import path from 'node:path'

import { asc, count, desc, eq, like, max } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { brainSuggestions, formationDocuments, formations, news, stores, users } from '@/server/db/schema'
import { slugify } from '@/lib/slug'
import { sanitizeNewsHtml } from '@/server/news/sanitize'
import { hashPassword } from '@/server/auth/password'
import { generatePassword } from '@/server/auth/generate-password'
import { prepareUserInsert } from '@/lib/admin/prepare-user'
import { stripPassword } from '@/lib/admin/sanitize-user'
import {
  MAX_IMPORT_ROWS,
  normalizeHeader,
  parseStoreRows,
  parseUserRows,
  resolveStoreId,
  type RowError,
} from '@/lib/admin/csv-import'
import {
  formationCreateSchema,
  formationUpdateSchema,
  newsCreateSchema,
  newsSetStatusSchema,
  newsUpdateSchema,
  storeCreateSchema,
  storeUpdateSchema,
  suggestionCreateSchema,
  suggestionReorderSchema,
  suggestionUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@/lib/admin/schemas'
import { faqBuilderRouter } from './admin-faq-builder'
import { faqGapsRouter } from './admin-faq-gaps'
import { difySyncRouter } from './dify-sync'
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
const bulkImportSchema = z.array(z.record(z.string(), z.string())).max(MAX_IMPORT_ROWS)

const storesRouter = router({
  /** All stores ordered by name. */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(stores).orderBy(asc(stores.name))
  }),

  create: adminProcedure.input(storeCreateSchema).mutation(async ({ ctx, input }) => {
    try {
      const [row] = await ctx.db.insert(stores).values(input).returning()
      return row
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Nom de magasin déjà utilisé' })
      }
      throw err
    }
  }),

  update: adminProcedure.input(storeUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, ...fields } = input
    try {
      const [row] = await ctx.db
        .update(stores)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(stores.id, id))
        .returning()

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      return row
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Nom de magasin déjà utilisé' })
      }
      throw err
    }
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
      // Collecte AVANT le delete : la cascade DB efface formation_documents,
      // or les fichiers vivent à `${UPLOADS_DIR}/<docId>.pdf`.
      const docs = await ctx.db
        .select({ id: formationDocuments.id })
        .from(formationDocuments)
        .where(eq(formationDocuments.formationId, input.id))

      const [row] = await ctx.db
        .delete(formations)
        .where(eq(formations.id, input.id))
        .returning()

      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Formation introuvable' })

      // Nettoyage disque best-effort (même pattern que news.delete) : un échec
      // fs ne fait pas échouer la mutation — la cascade DB a déjà eu lieu.
      const dir = process.env.UPLOADS_DIR || '/app/uploads'
      await Promise.all(
        docs.map((d) => fs.rm(path.join(dir, `${d.id}.pdf`), { force: true }).catch(() => {})),
      )
      const coversDir = path.join(dir, 'formations')
      try {
        const entries = await fs.readdir(coversDir)
        await Promise.all(
          entries
            .filter((name) => name.startsWith(`${input.id}.`))
            .map((name) => fs.rm(path.join(coversDir, name), { force: true })),
        )
      } catch {
        // Dossier absent (aucune couverture jamais uploadée) — ignore.
      }

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

      // Nettoyage disque best-effort (même pattern que formations.delete) : un
      // échec fs ne fait pas échouer la mutation — la ligne DB est déjà supprimée.
      const dir = process.env.UPLOADS_DIR || '/app/uploads'
      await fs.rm(path.join(dir, `${input.docId}.pdf`), { force: true }).catch(() => {})

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

    if (rest.role === 'employee') {
      if (id === ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Impossible de se rétrograder soi-même',
        })
      }
      const [target] = await ctx.db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
      if (target?.role === 'admin') {
        // Fenêtre de course admin↔admin assumée sans transaction : deux demotes
        // strictement simultanés sont irréalistes sur ce produit interne.
        // Et même dans ce cas, la situation est récupérable : bootstrap-admin.mjs
        // est promotion-only et re-promeut l'admin bootstrap à chaque boot.
        const [admins] = await ctx.db
          .select({ n: count() })
          .from(users)
          .where(eq(users.role, 'admin'))
        if ((admins?.n ?? 0) <= 1) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Il doit rester au moins un administrateur',
          })
        }
      }
    }

    const fields: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (password !== undefined) {
      fields.passwordHash = await hashPassword(password)
      fields.passwordChangedAt = new Date()
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
   * Reset a user's password to a fresh server-generated one. Only the argon2
   * hash is stored; the plaintext is returned ONCE so the admin can hand it
   * over (same pattern as CSV bulk import).
   */
  resetPassword: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const password = generatePassword()
      const passwordHash = await hashPassword(password)

      const [row] = await ctx.db
        .update(users)
        .set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, input.id))
        .returning({ id: users.id, email: users.email })

      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' })
      return { id: row.id, email: row.email, password }
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
        created.push({ row, email: insert.email, firstName: data.firstName, password })
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

/**
 * Build a slug unique within the `news` table. Starts from `slugify(title)` and,
 * if that base (or a `-N` variant) is already taken, picks the lowest free
 * `-2`, `-3`, … suffix. A single query fetches all colliding slugs.
 */
async function uniqueNewsSlug(
  db: typeof import('@/server/db').db,
  title: string,
): Promise<string> {
  const base = slugify(title) || 'article'
  const existing = await db
    .select({ slug: news.slug })
    .from(news)
    .where(like(news.slug, `${base}%`))
  const taken = new Set(existing.map((r) => r.slug))

  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

const newsRouter = router({
  /** All news (any status), most recently updated first. */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(news).orderBy(desc(news.updatedAt))
  }),

  /** Full article for editing. NOT_FOUND if missing. */
  byId: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(news).where(eq(news.id, input.id)).limit(1)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Actualité introuvable' })
      return row
    }),

  create: adminProcedure.input(newsCreateSchema).mutation(async ({ ctx, input }) => {
    const slug = await uniqueNewsSlug(ctx.db, input.title)
    const values = {
      slug,
      title: input.title,
      excerpt: input.excerpt ?? null,
      contentHtml: input.contentHtml !== undefined ? sanitizeNewsHtml(input.contentHtml) : '',
      authorName: input.authorName ?? null,
      status: 'draft' as const,
    }
    try {
      const [row] = await ctx.db.insert(news).values(values).returning()
      return row
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Slug race: another insert grabbed our slug between check and insert.
        throw new TRPCError({ code: 'CONFLICT', message: 'Slug déjà utilisé' })
      }
      throw err
    }
  }),

  update: adminProcedure.input(newsUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, contentHtml, ...rest } = input
    const fields: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (contentHtml !== undefined) {
      fields.contentHtml = sanitizeNewsHtml(contentHtml)
    }

    const [row] = await ctx.db.update(news).set(fields).where(eq(news.id, id)).returning()
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Actualité introuvable' })
    return row
  }),

  setStatus: adminProcedure.input(newsSetStatusSchema).mutation(async ({ ctx, input }) => {
    const [current] = await ctx.db
      .select({ publishedAt: news.publishedAt })
      .from(news)
      .where(eq(news.id, input.id))
      .limit(1)
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Actualité introuvable' })

    const fields: Record<string, unknown> = { status: input.status, updatedAt: new Date() }
    // First publish stamps publishedAt; re-publishing keeps the original date.
    if (input.status === 'published' && current.publishedAt === null) {
      fields.publishedAt = new Date()
    }

    const [row] = await ctx.db.update(news).set(fields).where(eq(news.id, input.id)).returning()
    return row
  }),

  /** Delete the article row and remove its cover file(s) from the volume. */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.delete(news).where(eq(news.id, input.id)).returning()
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Actualité introuvable' })

      // Remove any `<id>.*` cover file. Best-effort: a missing dir is fine.
      const dir = path.join(process.env.UPLOADS_DIR || '/app/uploads', 'news')
      try {
        const entries = await fs.readdir(dir)
        await Promise.all(
          entries
            .filter((name) => name.startsWith(`${input.id}.`))
            .map((name) => fs.rm(path.join(dir, name), { force: true })),
        )
      } catch {
        // Directory may not exist yet (no cover ever uploaded) — ignore.
      }

      return { id: input.id }
    }),
})

const brainSuggestionsRouter = router({
  /** All suggestions (active or not), ordered for the admin list. */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(brainSuggestions)
      .orderBy(asc(brainSuggestions.sortOrder), asc(brainSuggestions.createdAt))
  }),

  /** Create at the end of the list (sortOrder = max + 1). */
  create: adminProcedure.input(suggestionCreateSchema).mutation(async ({ ctx, input }) => {
    const [{ value: maxOrder }] = await ctx.db
      .select({ value: max(brainSuggestions.sortOrder) })
      .from(brainSuggestions)
    const [row] = await ctx.db
      .insert(brainSuggestions)
      .values({ text: input.text, sortOrder: (maxOrder ?? -1) + 1 })
      .returning()
    return row
  }),

  update: adminProcedure.input(suggestionUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, ...fields } = input
    const [row] = await ctx.db
      .update(brainSuggestions)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(brainSuggestions.id, id))
      .returning()
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Suggestion introuvable' })
    return row
  }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(brainSuggestions)
        .where(eq(brainSuggestions.id, input.id))
        .returning()
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Suggestion introuvable' })
      return { id: input.id }
    }),

  /** Persist a full ordering: sortOrder = index in the given id list. */
  reorder: adminProcedure.input(suggestionReorderSchema).mutation(async ({ ctx, input }) => {
    const now = new Date()
    await ctx.db.transaction(async (tx) => {
      for (const [i, id] of input.ids.entries()) {
        await tx
          .update(brainSuggestions)
          .set({ sortOrder: i, updatedAt: now })
          .where(eq(brainSuggestions.id, id))
      }
    })
    return { ok: true }
  }),
})

export const adminRouter = router({
  stores: storesRouter,
  formations: formationsRouter,
  users: usersRouter,
  news: newsRouter,
  brainSuggestions: brainSuggestionsRouter,
  faqGaps: faqGapsRouter,
  faqBuilder: faqBuilderRouter,
  difySync: difySyncRouter,
})
