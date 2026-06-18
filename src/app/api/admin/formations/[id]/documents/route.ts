import fs from 'node:fs/promises'
import path from 'node:path'

import { desc, eq } from 'drizzle-orm'

import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { formationDocuments, formations } from '@/server/db/schema'
import { formatFileSize } from '@/lib/format-size'
import { isPdf } from '@/lib/upload/magic-bytes'

export const runtime = 'nodejs'

const MAX_SIZE = 25 * 1024 * 1024 // 25 Mo

function uploadsDir(): string {
  return process.env.UPLOADS_DIR || '/app/uploads'
}

/**
 * Upload d'un PDF rattaché à une formation. Admin uniquement.
 * Le fichier est écrit sur le volume persistant `/app/uploads/<docId>.pdf` ;
 * la ligne `formation_documents` stocke l'URL de téléchargement auth-gated.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: formationId } = await params

  const session = await auth()
  if (session?.user?.role !== 'admin') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  // La formation cible doit exister.
  const [formation] = await db
    .select({ id: formations.id })
    .from(formations)
    .where(eq(formations.id, formationId))
    .limit(1)
  if (!formation) {
    return Response.json({ error: 'formation_not_found' }, { status: 404 })
  }

  let file: File
  let buffer: Uint8Array
  let title: string
  let pages: number
  let isNew: boolean
  try {
    const form = await req.formData()
    const rawFile = form.get('file')
    if (!(rawFile instanceof File)) {
      return Response.json({ error: 'file_required' }, { status: 400 })
    }
    file = rawFile

    if (file.type !== 'application/pdf') {
      return Response.json({ error: 'invalid_type' }, { status: 415 })
    }
    if (file.size > MAX_SIZE) {
      return Response.json({ error: 'file_too_large' }, { status: 413 })
    }

    // The MIME `file.type` is client-controlled - verify the real %PDF
    // signature BEFORE any DB row or disk write, to reject early.
    buffer = new Uint8Array(await file.arrayBuffer())
    if (!isPdf(buffer)) {
      return Response.json({ error: 'invalid_type' }, { status: 415 })
    }

    const rawTitle = form.get('title')
    title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : file.name
    const rawPages = form.get('pages')
    pages = typeof rawPages === 'string' ? parseInt(rawPages, 10) || 0 : 0
    const rawIsNew = form.get('isNew')
    isNew = rawIsNew === 'true' || rawIsNew === 'on'
  } catch {
    return Response.json({ error: 'invalid_form' }, { status: 400 })
  }

  let docId: string
  try {
    // `order` = (max existant pour cette formation) + 1.
    const [last] = await db
      .select({ order: formationDocuments.order })
      .from(formationDocuments)
      .where(eq(formationDocuments.formationId, formationId))
      .orderBy(desc(formationDocuments.order))
      .limit(1)
    const nextOrder = (last?.order ?? -1) + 1

    // Insert avec placeholders non-null (colonnes NOT NULL) ; complété après écriture.
    const [inserted] = await db
      .insert(formationDocuments)
      .values({
        formationId,
        title,
        pages,
        sizeLabel: '',
        fileUrl: '',
        isNew,
        order: nextOrder,
      })
      .returning({ id: formationDocuments.id })
    docId = inserted.id
  } catch {
    return Response.json({ error: 'db_error' }, { status: 500 })
  }

  // Écriture du fichier sur le volume. En cas d'échec, on supprime la ligne
  // pour éviter un orphelin (ligne sans fichier).
  try {
    const dir = uploadsDir()
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${docId}.pdf`), Buffer.from(buffer))
  } catch {
    await db.delete(formationDocuments).where(eq(formationDocuments.id, docId)).catch(() => {})
    return Response.json({ error: 'write_failed' }, { status: 500 })
  }

  try {
    const [updated] = await db
      .update(formationDocuments)
      .set({
        fileUrl: `/api/documents/${docId}/download`,
        sizeLabel: formatFileSize(file.size),
      })
      .where(eq(formationDocuments.id, docId))
      .returning()
    return Response.json(updated, { status: 201 })
  } catch {
    return Response.json({ error: 'db_error' }, { status: 500 })
  }
}
