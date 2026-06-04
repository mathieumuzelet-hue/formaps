import fs from 'node:fs/promises'
import path from 'node:path'

import { auth } from '@/server/auth'

export const runtime = 'nodejs'

/** File extension → Content-Type for served covers. */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

function newsDir(): string {
  return path.join(process.env.UPLOADS_DIR || '/app/uploads', 'news')
}

/**
 * Sert l'image de couverture d'une actualité, réservée aux utilisateurs
 * authentifiés (le `<img>` same-origin du journal envoie le cookie de session).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await auth()
  if (!session?.user) {
    return new Response('unauthorized', { status: 401 })
  }

  const dir = newsDir()
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return new Response('not found', { status: 404 })
  }

  const fileName = entries.find((name) => name.startsWith(`${id}.`))
  if (!fileName) {
    return new Response('not found', { status: 404 })
  }

  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  const contentType = MIME_BY_EXT[ext]
  if (!contentType) {
    return new Response('not found', { status: 404 })
  }

  const buf = await fs.readFile(path.join(dir, fileName))
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=60',
    },
  })
}
