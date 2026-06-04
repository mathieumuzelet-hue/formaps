import fs from 'node:fs/promises'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { formationDocuments } from '@/server/db/schema'

export const runtime = 'nodejs'

function uploadsDir(): string {
  return process.env.UPLOADS_DIR || '/app/uploads'
}

/**
 * Téléchargement d'un PDF, réservé aux utilisateurs authentifiés (employee ou
 * admin). Sert le fichier inline depuis le volume persistant.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
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

  const filePath = path.join(uploadsDir(), `${docId}.pdf`)
  try {
    await fs.stat(filePath)
  } catch {
    return new Response('not found', { status: 404 })
  }

  const buf = await fs.readFile(filePath)
  const safeName = (doc.title || 'document').replace(/[^a-zA-Z0-9._-]/g, '_')
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}.pdf"`,
    },
  })
}
