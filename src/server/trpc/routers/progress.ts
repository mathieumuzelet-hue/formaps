import { count, eq } from 'drizzle-orm'

import { formationDocuments, formations, userDocumentViews } from '@/server/db/schema'
import { summarizeDocProgress } from '@/lib/progress'
import { protectedProcedure, router } from '../trpc'

export const progressRouter = router({
  /**
   * The current user's progress summary across all formations, computed from
   * document views: percent = viewed docs / total docs per formation.
   */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const totals = await ctx.db
      .select({ formationId: formationDocuments.formationId, total: count() })
      .from(formationDocuments)
      .groupBy(formationDocuments.formationId)

    const viewed = await ctx.db
      .select({ formationId: formationDocuments.formationId, viewed: count() })
      .from(userDocumentViews)
      .innerJoin(
        formationDocuments,
        eq(userDocumentViews.documentId, formationDocuments.id),
      )
      .where(eq(userDocumentViews.userId, ctx.user.id))
      .groupBy(formationDocuments.formationId)

    const [{ value: formationCount }] = await ctx.db
      .select({ value: count() })
      .from(formations)

    return summarizeDocProgress(totals, viewed, formationCount)
  }),
})
