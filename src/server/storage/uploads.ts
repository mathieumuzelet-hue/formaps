import path from 'node:path'

/** Volume persistant des PDF de formation (même valeur que la route download). */
export function uploadsDir(): string {
  return process.env.UPLOADS_DIR || '/app/uploads'
}

/** Chemin disque du PDF d'un document de formation. */
export function formationPdfPath(docId: string): string {
  return path.join(uploadsDir(), `${docId}.pdf`)
}
