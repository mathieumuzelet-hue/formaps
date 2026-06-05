import { and, desc, eq, gte, or } from 'drizzle-orm'

import { chatQueries } from '@/server/db/schema'
import { groupFaqGaps } from '@/lib/admin/faq-gaps'
import { adminProcedure, router } from '../trpc'

const WINDOW_DAYS = 30

/**
 * FAQ-gaps analysis: BRAIN questions from the last 30 days that had no
 * relevant source OR were disliked, grouped by normalized question text.
 */
export const faqGapsRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const rows = await ctx.db
      .select({
        query: chatQueries.query,
        createdAt: chatQueries.createdAt,
        retrievalScoreMax: chatQueries.retrievalScoreMax,
        retrievalCount: chatQueries.retrievalCount,
        feedback: chatQueries.feedback,
      })
      .from(chatQueries)
      .where(
        and(
          gte(chatQueries.createdAt, since),
          or(eq(chatQueries.hasRelevantSource, false), eq(chatQueries.feedback, 'dislike')),
        ),
      )
      .orderBy(desc(chatQueries.createdAt))

    return groupFaqGaps(rows)
  }),
})
