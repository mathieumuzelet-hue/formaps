import fs from 'node:fs/promises'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { formationDocuments, userDocumentViews } from '@/server/db/schema'

export const runtime = 'nodejs'

function uploadsDir(): string {
  return process.env.UPLOADS_DIR || '/app/uploads'
}

/**
 * Sert un PDF depuis le volume persistant, réservé aux utilisateurs
 * authentifiés (employee ou admin). Inline par défaut (visionneuse du
 * navigateur, bouton « Consulter ») ; `?download=1` force le téléchargement.
 */
export async function GET(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params

  const session = await auth()
  if (!session?.user) {
    return new Response('unauthorized', { status: 401 })
  }

  const [doc] = await db
    .select({ title: formationDocuments.title })
    .from(formationDocuments)
    .where(eq(formationDocuments.id, docId))
    .limit(1)
  if (!doc) {
    return new Response('not found', { status: 404 })
  }

  // Enregistre la vue (alimente la progression automatique) en fire-and-forget :
  // ne retarde jamais la réponse et ne la fait jamais échouer, même DB down.
  void Promise.resolve(
    db
      .insert(userDocumentViews)
      .values({ userId: session.user.id, documentId: docId })
      .onConflictDoNothing(),
  ).catch(() => {})

  const filePath = path.join(uploadsDir(), `${docId}.pdf`)
  try {
    await fs.stat(filePath)
  } catch {
    return new Response('not found', { status: 404 })
  }

  const buf = await fs.readFile(filePath)
  const safeName = (doc.title || 'document').replace(/[^a-zA-Z0-9._-]/g, '_')
  const wantsDownload = new URL(req.url).searchParams.get('download') === '1'
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${wantsDownload ? 'attachment' : 'inline'}; filename="${safeName}.pdf"`,
      // Document authentifié : jamais en cache partagé ni sur disque proxy.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
