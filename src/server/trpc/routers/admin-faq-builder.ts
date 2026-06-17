import { randomUUID } from 'node:crypto'

import { TRPCError } from '@trpc/server'
import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { faqDrafts } from '@/server/db/schema'
import { faqItemSchema, type FaqItem } from '@/lib/faq/types'
import { ClaudeOutputTruncatedError, createAnthropicClient } from '@/server/claude-core'
import { NoNewPairsError, generateMorePairs } from '@/server/faq/claude'
import { removeSyncedDocument } from '@/server/dify/sync-store'
import { adminProcedure, router } from '../trpc'

/**
 * FAQ builder drafts: list/edit/extend/delete. The initial generation lives
 * in POST /api/admin/faq-builder (multipart upload — out of tRPC's reach).
 */
export const faqBuilderRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: faqDrafts.id,
        sourceFilename: faqDrafts.sourceFilename,
        itemCount: sql<number>`jsonb_array_length(${faqDrafts.items})`,
        updatedAt: faqDrafts.updatedAt,
      })
      .from(faqDrafts)
      .orderBy(desc(faqDrafts.updatedAt))
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
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'anthropic_not_configured' })
      }
      // Read-modify-write: a concurrent updateItems during the Claude call
      // would be overwritten. Accepted for this mono-admin tool; the editor
      // also freezes saves while a generation is pending.
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
        if (err instanceof NoNewPairsError) {
          throw new TRPCError({ code: 'CONFLICT', message: 'no_new_pairs' })
        }
        if (err instanceof ClaudeOutputTruncatedError) {
          throw new TRPCError({ code: 'BAD_GATEWAY', message: 'output_truncated' })
        }
        console.error('[faq-builder] generateMore failed:', err)
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'generation_failed' })
      }

      const added: FaqItem[] = pairs.map((p) => ({
        id: randomUUID(),
        question: p.question,
        answer: p.answer,
        origin: 'generated',
      }))
      // Cap so the total never exceeds updateItems' zod cap (500) — exceeding
      // it would make the draft unsaveable in the editor.
      const room = Math.max(0, 500 - draft.items.length)
      const appended = added.slice(0, room)
      const items = [...draft.items, ...appended]
      const [row] = await ctx.db
        .update(faqDrafts)
        .set({ items, updatedAt: new Date() })
        .where(eq(faqDrafts.id, input.draftId))
        .returning({ id: faqDrafts.id })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      return { added: appended.length, items }
    }),

  delete: adminProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .delete(faqDrafts)
      .where(eq(faqDrafts.id, input.id))
      .returning({ id: faqDrafts.id })
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

    // Best-effort : purge le document Dify + la ligne dify_sync (même esprit que
    // le nettoyage disque des formations). Un échec ne fait pas échouer le delete.
    try {
      await removeSyncedDocument(ctx.db, 'faq_draft', input.id)
    } catch (err) {
      console.error('[faq-builder] unsync Dify après delete a échoué (on continue):', err)
    }

    return { ok: true }
  }),
})
