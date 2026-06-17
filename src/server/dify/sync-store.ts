import { and, eq } from 'drizzle-orm'
import type { db as Db } from '@/server/db'
import { difySync } from '@/server/db/schema'

type DbLike = typeof Db
type SourceType = 'faq_draft' | 'formation_doc'
type Status = 'pending' | 'synced' | 'failed'

export async function upsertSync(
  db: DbLike,
  args: {
    sourceType: SourceType
    sourceId: string
    datasetId: string
    difyDocumentId: string | null
    status: Status
    error?: string | null
  },
): Promise<void> {
  const syncedAt = args.status === 'synced' ? new Date() : null
  const row = {
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    datasetId: args.datasetId,
    difyDocumentId: args.difyDocumentId,
    status: args.status,
    error: args.error ?? null,
    syncedAt,
    updatedAt: new Date(),
  }
  await db
    .insert(difySync)
    .values(row)
    .onConflictDoUpdate({ target: [difySync.sourceType, difySync.sourceId], set: row })
}

export async function getSyncRow(
  db: DbLike,
  sourceType: SourceType,
  sourceId: string,
): Promise<{ difyDocumentId: string | null; datasetId: string } | null> {
  const rows = await db
    .select({ difyDocumentId: difySync.difyDocumentId, datasetId: difySync.datasetId })
    .from(difySync)
    .where(and(eq(difySync.sourceType, sourceType), eq(difySync.sourceId, sourceId)))
  return rows[0] ?? null
}
