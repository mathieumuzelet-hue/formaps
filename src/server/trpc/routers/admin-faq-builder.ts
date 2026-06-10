import { randomUUID } from 'node:crypto'

import { TRPCError } from '@trpc/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { faqDrafts } from '@/server/db/schema'
import { faqItemSchema, type FaqItem } from '@/lib/faq/types'
import { createAnthropicClient } from '@/server/claude-core'
import { generateMorePairs } from '@/server/faq/claude'
import { adminProcedure, router } from '../trpc'

/**
 * FAQ builder drafts: list/edit/extend/delete. The initial generation lives
 * in POST /api/admin/faq-builder (multipart upload — out of tRPC's reach).
 */
export const faqBuilderRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: faqDrafts.id,
        sourceFilename: faqDrafts.sourceFilename,
        items: faqDrafts.items,
        updatedAt: faqDrafts.updatedAt,
      })
      .from(faqDrafts)
      .orderBy(desc(faqDrafts.updatedAt))
    return rows.map((r) => ({
      id: r.id,
      sourceFilename: r.sourceFilename,
      itemCount: r.items.length,
      updatedAt: r.updatedAt,
    }))
  }),

  get: adminProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    // sourceText is intentionally NOT selected (can be hundreds of kB).
    const [row] = await ctx.db
      .select({
        id: faqDrafts.id,
        sourceFilename: faqDrafts.sourceFilename,
        items: faqDrafts.items,
        updatedAt: faqDrafts.updatedAt,
      })
      .from(faqDrafts)
      .where(eq(faqDrafts.id, input.id))
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
    return row
  }),

  updateItems: adminProcedure
    .input(z.object({ id: z.uuid(), items: z.array(faqItemSchema).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(faqDrafts)
        .set({ items: input.items, updatedAt: new Date() })
        .where(eq(faqDrafts.id, input.id))
        .returning({ id: faqDrafts.id })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true }
    }),

  generateMore: adminProcedure
    .input(z.object({ draftId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'anthropic_not_configured' })
      }
      const [draft] = await ctx.db
        .select({
          id: faqDrafts.id,
          sourceText: faqDrafts.sourceText,
          items: faqDrafts.items,
        })
        .from(faqDrafts)
        .where(eq(faqDrafts.id, input.draftId))
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND' })

      let pairs
      try {
        pairs = (
          await generateMorePairs(
            createAnthropicClient(),
            draft.sourceText,
            draft.items.map((i) => i.question),
          )
        ).data
      } catch (err) {
        console.error('[faq-builder] generateMore failed:', err)
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'generation_failed' })
      }

      const added: FaqItem[] = pairs.map((p) => ({
        id: randomUUID(),
        question: p.question,
        answer: p.answer,
        origin: 'generated',
      }))
      const items = [...draft.items, ...added]
      const [row] = await ctx.db
        .update(faqDrafts)
        .set({ items, updatedAt: new Date() })
        .where(eq(faqDrafts.id, input.draftId))
        .returning({ id: faqDrafts.id })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      return { added: added.length, items }
    }),

  delete: adminProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .delete(faqDrafts)
      .where(eq(faqDrafts.id, input.id))
      .returning({ id: faqDrafts.id })
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true }
  }),
})
