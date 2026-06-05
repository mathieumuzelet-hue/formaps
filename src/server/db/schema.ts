import { pgTable, uuid, text, integer, date, timestamp, boolean, pgEnum, unique, real, index } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ['employee', 'admin'])
export const kindEnum = pgEnum('formation_kind', ['sharepoint', 'pdf'])
export const progressEnum = pgEnum('progress_status', ['not_started', 'in_progress', 'done'])
export const newsStatusEnum = pgEnum('news_status', ['draft', 'published'])

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  basculeDate: date('bascule_date').notNull(),
  currentStep: integer('current_step').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  role: roleEnum('role').notNull().default('employee'),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
  difyConversationId: text('dify_conversation_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const formations = pgTable('formations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  tag: text('tag').notNull(),
  icon: text('icon').notNull(),
  description: text('description').notNull(),
  kind: kindEnum('kind').notNull().default('sharepoint'),
  sharepointUrl: text('sharepoint_url'),
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
})

export const userFormationProgress = pgTable('user_formation_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  formationId: uuid('formation_id').notNull().references(() => formations.id, { onDelete: 'cascade' }),
  status: progressEnum('status').notNull().default('not_started'),
  progressPercent: integer('progress_percent').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({ uniqUserFormation: unique().on(t.userId, t.formationId) }))

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
})

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
