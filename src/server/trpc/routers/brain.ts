import { asc, eq } from 'drizzle-orm'

import { brainSuggestions } from '@/server/db/schema'
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
})
