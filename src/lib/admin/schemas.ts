import { z } from 'zod'

/**
 * Zod input schemas for the admin router. Kept in a server-free module so they
 * can be imported by unit tests without dragging in the tRPC/auth runtime.
 */

/** Input schema for `admin.stores.update`. */
export const storeUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  basculeDate: z.string().optional(),
  currentStep: z.number().int().min(0).max(4).optional(),
})

/** Input schema for `admin.stores.create`. */
export const storeCreateSchema = z.object({
  name: z.string().min(1),
  basculeDate: z.string().min(1),
  currentStep: z.number().int().min(0).max(4),
})

/** Shared formation field schemas (used by create; partial for update). */
export const formationFields = {
  name: z.string().min(1),
  slug: z.string().min(1),
  tag: z.string(),
  icon: z.string(),
  description: z.string(),
  kind: z.enum(['sharepoint', 'pdf']),
  sharepointUrl: z.string().url().nullable().optional(),
  docCount: z.number().int().min(0).default(0),
  order: z.number().int().default(0),
}

export const formationCreateSchema = z.object(formationFields)

export const formationUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  tag: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  kind: z.enum(['sharepoint', 'pdf']).optional(),
  sharepointUrl: z.string().url().nullable().optional(),
  docCount: z.number().int().min(0).optional(),
  order: z.number().int().optional(),
})

export const userCreateSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['employee', 'admin']),
  storeId: z.string().uuid().nullable().optional(),
})

export const userUpdateSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1).optional(),
  role: z.enum(['employee', 'admin']).optional(),
  storeId: z.string().uuid().nullable().optional(),
  password: z.string().min(8).optional(),
})

/** Input schema for `admin.news.create`. */
export const newsCreateSchema = z.object({
  title: z.string().min(1),
  excerpt: z.string().nullable().optional(),
  contentHtml: z.string().optional(),
  authorName: z.string().nullable().optional(),
})

/** Input schema for `admin.news.update`. */
export const newsUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).optional(),
  excerpt: z.string().nullable().optional(),
  contentHtml: z.string().optional(),
  authorName: z.string().nullable().optional(),
})

/** Input schema for `admin.news.setStatus`. */
export const newsSetStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['draft', 'published']),
})
