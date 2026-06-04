import { and, asc, eq, ne } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { formationDocuments, formations } from '@/server/db/schema'
import { protectedProcedure, router } from '../trpc'

export const formationRouter = router({
  /** All formations ordered by `order` ascending. */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(formations).orderBy(asc(formations.order))
  }),

  /**
   * A single formation by slug, with its ordered documents and up to 3 related
   * formations sharing the same tag.
   */
  bySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const [formation] = await ctx.db
        .select()
        .from(formations)
        .where(eq(formations.slug, input.slug))
        .limit(1)

      if (!formation) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      const documents = await ctx.db
        .select()
        .from(formationDocuments)
        .where(eq(formationDocuments.formationId, formation.id))
        .orderBy(asc(formationDocuments.order))

      const related = await ctx.db
        .select()
        .from(formations)
        .where(and(eq(formations.tag, formation.tag), ne(formations.id, formation.id)))
        .orderBy(asc(formations.order))
        .limit(3)

      return { formation, documents, related }
    }),
})
