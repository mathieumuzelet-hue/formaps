import fs from 'node:fs/promises'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { news } from '@/server/db/schema'

export const runtime = 'nodejs'

const MAX_SIZE = 5 * 1024 * 1024 // 5 Mo

/** Accepted image mime types → file extension on disk. */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function newsDir(): string {
  return path.join(process.env.UPLOADS_DIR || '/app/uploads', 'news')
}

/**
 * Upload de l'image de couverture d'une actualité. Admin uniquement.
 * Le fichier est écrit `${UPLOADS_DIR}/news/<id>.<ext>` sur le volume persistant ;
 * toute couverture précédente (`<id>.*`) est supprimée pour éviter les orphelins.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await auth()
  if (session?.user?.role !== 'admin') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  // L'actualité cible doit exister.
  const [row] = await db.select({ id: news.id }).from(news).where(eq(news.id, id)).limit(1)
  if (!row) {
    return Response.json({ error: 'news_not_found' }, { status: 404 })
  }

  let file: File
  try {
    const form = await req.formData()
    const rawFile = form.get('file')
    if (!(rawFile instanceof File)) {
      return Response.json({ error: 'file_required' }, { status: 400 })
    }
    file = rawFile
  } catch {
    return Response.json({ error: 'invalid_form' }, { status: 400 })
  }

  if (!file.type.startsWith('image/')) {
    return Response.json({ error: 'invalid_type' }, { status: 415 })
  }
  const ext = EXT_BY_MIME[file.type]
  if (!ext) {
    return Response.json({ error: 'unsupported_image_type' }, { status: 415 })
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: 'file_too_large' }, { status: 413 })
  }

  // Écriture du fichier : on purge d'abord toute couverture existante `<id>.*`.
  try {
    const dir = newsDir()
    await fs.mkdir(dir, { recursive: true })
    const entries = await fs.readdir(dir).catch(() => [] as string[])
    await Promise.all(
      entries
        .filter((name) => name.startsWith(`${id}.`))
        .map((name) => fs.rm(path.join(dir, name), { force: true })),
    )
    await fs.writeFile(path.join(dir, `${id}.${ext}`), Buffer.from(await file.arrayBuffer()))
  } catch {
    return Response.json({ error: 'write_failed' }, { status: 500 })
  }

  try {
    const [updated] = await db
      .update(news)
      .set({ coverImageUrl: `/api/news/${id}/cover`, updatedAt: new Date() })
      .where(eq(news.id, id))
      .returning()
    return Response.json(updated, { status: 201 })
  } catch {
    return Response.json({ error: 'db_error' }, { status: 500 })
  }
}
