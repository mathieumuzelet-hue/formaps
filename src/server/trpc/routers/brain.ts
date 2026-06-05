import { and, asc, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { brainSuggestions, chatQueries } from '@/server/db/schema'
import { sendFeedback } from '@/server/dify/client'
import { protectedProcedure, router } from '../trpc'

/**
 * Reader-facing BRAIN router. Every logged-in employee can read the active
 * suggestion pills shown under the chat composer.
 */
export const brainRouter = router({
  /** Active suggestions, in display order. */
  suggestions: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: brainSuggestions.id, text: brainSuggestions.text })
      .from(brainSuggestions)
      .where(eq(brainSuggestions.isActive, true))
      .orderBy(asc(brainSuggestions.sortOrder), asc(brainSuggestions.createdAt))
  }),

  /**
   * Records a 👍/👎 on one of the CURRENT user's answers, then relays it to
   * Dify best-effort (local row is the source of truth for /admin/faq-gaps).
   */
  feedback: protectedProcedure
    .input(z.object({ messageId: z.string().min(1), feedback: z.enum(['like', 'dislike']) }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .update(chatQueries)
        .set({ feedback: input.feedback })
        .where(and(eq(chatQueries.messageId, input.messageId), eq(chatQueries.userId, ctx.user.id)))
        .returning({ id: chatQueries.id })

      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Message introuvable' })
      }

      try {
        await sendFeedback({ messageId: input.messageId, rating: input.feedback, user: ctx.user.id })
      } catch (err) {
        console.error('[brain] relais feedback Dify a échoué:', err)
      }

      return { ok: true }
    }),
})
