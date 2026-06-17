import { pgTable, uuid, text, integer, date, timestamp, boolean, pgEnum, real, index, uniqueIndex, primaryKey, jsonb } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import type { FaqItem } from '@/lib/faq/types'

export const roleEnum = pgEnum('role', ['employee', 'admin'])
export const kindEnum = pgEnum('formation_kind', ['sharepoint', 'pdf'])
export const newsStatusEnum = pgEnum('news_status', ['draft', 'published'])
export const difySourceTypeEnum = pgEnum('dify_source_type', ['faq_draft', 'formation_doc'])
export const difySyncStatusEnum = pgEnum('dify_sync_status', ['pending', 'synced', 'failed'])

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  basculeDate: date('bascule_date').notNull(),
  currentStep: integer('current_step').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  // Bumped on every password change/reset; tokens carry it as a claim and any
  // mismatch kills the session (see src/server/auth/token-validation.ts).
  passwordChangedAt: timestamp('password_changed_at').defaultNow().notNull(),
  firstName: text('first_name').notNull(),
  role: roleEnum('role').notNull().default('employee'),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
  difyConversationId: text('dify_conversation_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  // Défense en profondeur : l'app normalise (normalizeEmail), Postgres verrouille.
  emailLowerIdx: uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
}))

export const formations = pgTable('formations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  tag: text('tag').notNull(),
  icon: text('icon').notNull(),
  description: text('description').notNull(),
  kind: kindEnum('kind').notNull().default('sharepoint'),
  sharepointUrl: text('sharepoint_url'),
  coverImageUrl: text('cover_image_url'), // /api/formations/<id>/cover once uploaded
  docCount: integer('doc_count').notNull().default(0),
  order: integer('order').notNull().default(0),
})

export const formationDocuments = pgTable('formation_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  formationId: uuid('formation_id').notNull().references(() => formations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  pages: integer('pages').notNull(),
  sizeLabel: text('size_label').notNull(),
  fileUrl: text('file_url').notNull(),
  isNew: boolean('is_new').notNull().default(false),
  order: integer('order').notNull().default(0),
}, (t) => ({
  // Chaque page formation liste ses documents par formation_id.
  formationIdIdx: index('formation_documents_formation_id_idx').on(t.formationId),
}))

/**
 * One row per (user, document) recorded the first time the user opens or
 * downloads the document (`GET /api/documents/[docId]/download`, inserted
 * fire-and-forget with `onConflictDoNothing`). Drives the automatic formation
 * progression computed by `progress.mine`.
 */
export const userDocumentViews = pgTable('user_document_views', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => formationDocuments.id, { onDelete: 'cascade' }),
  viewedAt: timestamp('viewed_at').defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.documentId] }) }))

export const news = pgTable('news', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt'),                 // chapô
  contentHtml: text('content_html').notNull().default(''),
  coverImageUrl: text('cover_image_url'),   // /api/news/<id>/cover once uploaded
  status: newsStatusEnum('status').notNull().default('draft'),
  authorName: text('author_name'),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  // Liste publique : WHERE status = 'published' ORDER BY published_at DESC.
  statusPublishedAtIdx: index('news_status_published_at_idx').on(t.status, t.publishedAt),
}))

/**
 * One row per BRAIN question/answer, with Dify retrieval metadata and user
 * feedback. Feeds the /admin/faq-gaps view. Inserted fire-and-forget by
 * /api/brain — never blocks the chat response.
 */
export const chatQueries = pgTable('chat_queries', {
  id: uuid('id').primaryKey().defaultRandom(),
  query: text('query').notNull(),
  answer: text('answer').notNull(),
  conversationId: text('conversation_id').notNull(),
  messageId: text('message_id').notNull().unique(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  retrievalScoreMax: real('retrieval_score_max'),
  retrievalCount: integer('retrieval_count').notNull(),
  hasRelevantSource: boolean('has_relevant_source').notNull(),
  feedback: text('feedback'), // 'like' | 'dislike' | null
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  createdAtIdx: index('chat_queries_created_at_idx').on(t.createdAt),
  hasRelevantSourceIdx: index('chat_queries_has_relevant_source_idx').on(t.hasRelevantSource),
  feedbackIdx: index('chat_queries_feedback_idx').on(t.feedback),
}))

export const brainSuggestions = pgTable('brain_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  text: text('text').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * FAQ builder drafts (admin tool). `sourceText` keeps the extracted document
 * text so "Générer plus" re-prompts Claude without re-uploading the file.
 * `items` is the ordered Q/A list, replaced atomically by `updateItems`.
 */
export const faqDrafts = pgTable('faq_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceFilename: text('source_filename').notNull(),
  sourceText: text('source_text').notNull(),
  items: jsonb('items').$type<FaqItem[]>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Pont APS → Dify : une ligne par contenu source poussé vers un dataset Dify.
 * sourceId est polymorphe (faqDrafts.id | formationDocuments.id) — pas de FK,
 * cohérence gérée applicativement (unsync au delete de la source).
 */
export const difySync = pgTable('dify_sync', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceType: difySourceTypeEnum('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  datasetId: text('dataset_id').notNull(),
  difyDocumentId: text('dify_document_id'),
  status: difySyncStatusEnum('status').notNull().default('pending'),
  error: text('error'),
  syncedAt: timestamp('synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  sourceUnique: uniqueIndex('dify_sync_source_unique').on(t.sourceType, t.sourceId),
}))
