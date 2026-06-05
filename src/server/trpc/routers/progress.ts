import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'

import { formations, userFormationProgress } from '@/server/db/schema'
import { summarizeProgress, type ProgressRow } from '@/lib/progress'
import { protectedProcedure, router } from '../trpc'

export const progressRouter = router({
  /** The current user's progress summary across all formations. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        formationId: userFormationProgress.formationId,
        status: userFormationProgress.status,
        progressPercent: userFormationProgress.progressPercent,
      })
      .from(userFormationProgress)
      .where(eq(userFormationProgress.userId, ctx.user.id))

    const [{ value: total }] = await ctx.db
      .select({ value: count() })
      .from(formations)

    return summarizeProgress(rows as ProgressRow[], total)
  }),

  /**
   * Mark a formation as done for the current user. Upserts on the unique
   * `(userId, formationId)` constraint.
   */
  markDone: protectedProcedure
    .input(z.object({ formationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date()
      const [row] = await ctx.db
        .insert(userFormationProgress)
        .values({
          userId: ctx.user.id,
          formationId: input.formationId,
          status: 'done',
          progressPercent: 100,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userFormationProgress.userId, userFormationProgress.formationId],
          set: { status: 'done', progressPercent: 100, updatedAt: now },
        })
        .returning()

      return row
    }),

  /**
   * Revert a formation to "not started" for the current user by deleting the
   * progress row. Idempotent: succeeds even when no row exists.
   */
  markUndone: protectedProcedure
    .input(z.object({ formationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(userFormationProgress)
        .where(
          and(
            eq(userFormationProgress.userId, ctx.user.id),
            eq(userFormationProgress.formationId, input.formationId),
          ),
        )

      return { formationId: input.formationId }
    }),
})
