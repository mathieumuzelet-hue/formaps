import { readFile } from 'node:fs/promises'

import { TRPCError } from '@trpc/server'
import { eq, inArray, and } from 'drizzle-orm'
import { z } from 'zod'

import { faqDrafts, difySync, formationDocuments } from '@/server/db/schema'
import { buildFaqCsv } from '@/lib/admin/faq-csv'
import {
  createQaCsvDocument,
  updateQaCsvDocument,
  createDocumentByFile,
  updateDocumentByFile,
} from '@/server/dify/knowledge'
import { upsertSync, getSyncRow, removeSyncedDocument } from '@/server/dify/sync-store'
import { formationPdfPath } from '@/server/storage/uploads'
import { adminProcedure, router } from '../trpc'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'dify_knowledge_not_configured' })
  }
  return v
}

const sourceTypeSchema = z.enum(['faq_draft', 'formation_doc'])

export const difySyncRouter = router({
  pushFaq: adminProcedure
    .input(z.object({ draftId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const datasetId = requireEnv('DIFY_QA_DATASET_ID')
      const [draft] = await ctx.db
        .select({ id: faqDrafts.id, sourceFilename: faqDrafts.sourceFilename, items: faqDrafts.items })
        .from(faqDrafts)
        .where(eq(faqDrafts.id, input.draftId))
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND' })

      // Dify ingère les Q&A via un CSV `question,answer` uploadé en doc_form
      // qa_model (l'API segments renvoie 404 sur ce type de dataset). Même format
      // que l'export FAQ Builder. Nom de fichier en .csv pour que Dify le parse.
      const csv = buildFaqCsv(draft.items)
      const name = draft.sourceFilename.replace(/\.[^.]+$/, '') + '.csv'
      const existing = await getSyncRow(ctx.db, 'faq_draft', input.draftId)
      // On persiste le dataset RÉELLEMENT visé : un update cible le dataset du doc
      // existant, un create le dataset courant. Sinon, si DIFY_QA_DATASET_ID a
      // changé après le 1er sync, le registre pointerait vers un dataset où le doc
      // n'existe pas (et un unsync supprimerait au mauvais endroit).
      const targetDatasetId = existing?.difyDocumentId ? existing.datasetId : datasetId

      try {
        let documentId: string
        if (existing?.difyDocumentId) {
          await updateQaCsvDocument({
            datasetId: existing.datasetId, documentId: existing.difyDocumentId, name, csv,
          })
          documentId = existing.difyDocumentId
        } else {
          ;({ documentId } = await createQaCsvDocument({ datasetId, name, csv }))
        }
        await upsertSync(ctx.db, {
          sourceType: 'faq_draft', sourceId: input.draftId, datasetId: targetDatasetId,
          difyDocumentId: documentId, status: 'synced',
        })
        return { documentId }
      } catch (err) {
        await upsertSync(ctx.db, {
          sourceType: 'faq_draft', sourceId: input.draftId, datasetId: targetDatasetId,
          difyDocumentId: existing?.difyDocumentId ?? null, status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'dify_push_failed' })
      }
    }),

  pushFormationDoc: adminProcedure
    .input(z.object({ docId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const datasetId = requireEnv('DIFY_DOCS_DATASET_ID')
      const [doc] = await ctx.db
        .select({ id: formationDocuments.id, title: formationDocuments.title })
        .from(formationDocuments)
        .where(eq(formationDocuments.id, input.docId))
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND' })

      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await readFile(formationPdfPath(input.docId)))
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'pdf_file_missing' })
      }
      const name = `${doc.title}.pdf`
      const existing = await getSyncRow(ctx.db, 'formation_doc', input.docId)

      try {
        let documentId: string
        if (existing?.difyDocumentId) {
          await updateDocumentByFile({
            datasetId: existing.datasetId, documentId: existing.difyDocumentId, name, bytes,
          })
          documentId = existing.difyDocumentId
        } else {
          ;({ documentId } = await createDocumentByFile({ datasetId, name, bytes }))
        }
        await upsertSync(ctx.db, {
          sourceType: 'formation_doc', sourceId: input.docId, datasetId,
          difyDocumentId: documentId, status: 'synced',
        })
        return { documentId }
      } catch (err) {
        await upsertSync(ctx.db, {
          sourceType: 'formation_doc', sourceId: input.docId, datasetId,
          difyDocumentId: existing?.difyDocumentId ?? null, status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'dify_push_failed' })
      }
    }),

  unsync: adminProcedure
    .input(z.object({ sourceType: sourceTypeSchema, sourceId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await removeSyncedDocument(ctx.db, input.sourceType, input.sourceId)
      return { ok: true as const }
    }),

  status: adminProcedure
    .input(z.object({ sourceType: sourceTypeSchema, sourceIds: z.array(z.uuid()).max(500) }))
    .query(async ({ ctx, input }) => {
      if (input.sourceIds.length === 0) return []
      return ctx.db
        .select({
          sourceId: difySync.sourceId,
          status: difySync.status,
          syncedAt: difySync.syncedAt,
          error: difySync.error,
        })
        .from(difySync)
        .where(and(eq(difySync.sourceType, input.sourceType), inArray(difySync.sourceId, input.sourceIds)))
    }),
})
