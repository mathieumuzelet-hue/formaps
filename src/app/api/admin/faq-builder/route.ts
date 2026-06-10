import { randomUUID } from 'node:crypto'

import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { faqDrafts } from '@/server/db/schema'
import { ClaudeOutputTruncatedError, createAnthropicClient } from '@/server/claude-core'
import { generateFaqPairs } from '@/server/faq/claude'
import { extractPages, PdfUnreadableError } from '@/server/embed-test/extract'
import { DocxUnreadableError, extractDocxText } from '@/server/faq/extract-docx'
import type { FaqItem } from '@/lib/faq/types'

export const runtime = 'nodejs'

const MAX_SIZE = 25 * 1024 * 1024 // same ceiling as embed-test
const MIN_TEXT_CHARS = 200 // below this the document is likely scanned (spec)

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Extension AND magic bytes must agree — both checked (audit convention). */
function sniffKind(name: string, bytes: Uint8Array): 'pdf' | 'docx' | null {
  const lower = name.toLowerCase()
  const isPdf =
    bytes.length >= 4 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // %PDF
  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 // PK\x03\x04
  if (lower.endsWith('.pdf') && isPdf) return 'pdf'
  if (lower.endsWith('.docx') && isZip) return 'docx'
  return null
}

/**
 * FAQ builder generation: multipart PDF/.docx in, one Claude call, one
 * `faq_drafts` row out. Admin only. The extracted text is persisted so
 * "Générer plus" works later without re-uploading the file.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user) return json({ error: 'unauthorized' }, 401)
  if (session.user.role !== 'admin') return json({ error: 'forbidden' }, 403)
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'anthropic_not_configured' }, 503)

  let file: File
  try {
    const form = await req.formData()
    const raw = form.get('file')
    if (!(raw instanceof File)) return json({ error: 'file_required' }, 400)
    file = raw
  } catch {
    return json({ error: 'invalid_form' }, 400)
  }
  if (file.size > MAX_SIZE) return json({ error: 'file_too_large' }, 413)

  const buffer = new Uint8Array(await file.arrayBuffer())
  const kind = sniffKind(file.name, buffer)
  if (!kind) return json({ error: 'invalid_type' }, 415)

  let text: string
  try {
    text =
      kind === 'pdf'
        ? (await extractPages(buffer)).pages.join('\n\n')
        : await extractDocxText(buffer)
  } catch (err) {
    if (err instanceof PdfUnreadableError || err instanceof DocxUnreadableError) {
      return json({ error: 'unreadable_document' }, 422)
    }
    throw err
  }
  if (text.trim().length < MIN_TEXT_CHARS) return json({ error: 'empty_text' }, 422)

  let pairs
  try {
    pairs = (await generateFaqPairs(createAnthropicClient(), text)).data
  } catch (err) {
    if (err instanceof ClaudeOutputTruncatedError) {
      console.error('[faq-builder] Claude output truncated at max_tokens')
      return json({ error: 'output_truncated' }, 502)
    }
    console.error('[faq-builder] generation failed:', err)
    return json({ error: 'generation_failed' }, 502)
  }

  const items: FaqItem[] = pairs.map((p) => ({
    id: randomUUID(),
    question: p.question,
    answer: p.answer,
    origin: 'generated',
  }))
  const [draft] = await db
    .insert(faqDrafts)
    .values({ sourceFilename: file.name.slice(0, 255), sourceText: text, items })
    .returning({ id: faqDrafts.id })
  return json({ id: draft.id, count: items.length }, 201)
}
