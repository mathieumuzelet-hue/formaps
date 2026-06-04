import { desc, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { news } from '@/server/db/schema'
import { protectedProcedure, router } from '../trpc'

/**
 * Reader-facing news router. Gated by `protectedProcedure`: every logged-in
 * employee may read published articles on the journal page. Drafts are never
 * exposed here.
 */
export const newsRouter = router({
  /**
   * Published articles, newest first. Intentionally omits `contentHtml` to keep
   * the list payload light — the full body is fetched per-article via `bySlug`.
   */
  listPublished: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: news.id,
        slug: news.slug,
        title: news.title,
        excerpt: news.excerpt,
        coverImageUrl: news.coverImageUrl,
        publishedAt: news.publishedAt,
        authorName: news.authorName,
      })
      .from(news)
      .where(eq(news.status, 'published'))
      .orderBy(desc(news.publishedAt))
  }),

  /** A single PUBLISHED article (full body). NOT_FOUND if missing or draft. */
  bySlug: protectedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(news)
        .where(eq(news.slug, input.slug))
        .limit(1)

      if (!row || row.status !== 'published') {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      return row
    }),
})
