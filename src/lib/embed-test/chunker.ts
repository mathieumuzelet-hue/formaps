/**
 * Pure simulation of Dify's chunking so configs can be compared WITHOUT
 * touching the Dify instance. Token counting uses gpt-tokenizer (GPT-family),
 * matching how Dify measures "maximum chunk length" — deliberately NOT a
 * Claude tokenizer.
 */
import { decode, encode } from 'gpt-tokenizer'

import type { ChunkConfig } from '@/lib/embed-test/types'

export type Chunk = { text: string; parentText?: string }

export function countTokens(text: string): number {
  return encode(text).length
}

/** Claude proposes separators as escaped strings ("\\n\\n") — unescape them. */
export function normalizeSeparator(separator: string): string {
  return separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

export function preprocess(
  text: string,
  rules: ChunkConfig['preprocessing'],
): string {
  let out = text
  if (rules.removeUrlsEmails) {
    out = out
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '')
  }
  if (rules.removeExtraSpaces) {
    out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
  }
  return out.trim()
}

/** Hard token-window split for segments that exceed maxTokens on their own. */
function splitByTokens(text: string, maxTokens: number): string[] {
  const tokens = encode(text)
  const parts: string[] = []
  for (let i = 0; i < tokens.length; i += maxTokens) {
    const piece = decode(tokens.slice(i, i + maxTokens)).trim()
    if (piece) parts.push(piece)
  }
  return parts
}

/**
 * General-mode chunking: split on separator, merge consecutive segments while
 * they fit in maxTokens, token-split oversized segments, then prepend the
 * last `overlapTokens` tokens of the previous chunk.
 */
function chunkGeneral(
  text: string,
  separator: string,
  maxTokens: number,
  overlapTokens: number,
): string[] {
  const segments = (text.includes(separator) ? text.split(separator) : [text])
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const pieces: string[] = []
  for (const seg of segments) {
    if (countTokens(seg) <= maxTokens) pieces.push(seg)
    else pieces.push(...splitByTokens(seg, maxTokens))
  }

  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    const candidate = current ? current + separator + piece : piece
    if (countTokens(candidate) <= maxTokens) {
      current = candidate
    } else {
      if (current) chunks.push(current)
      current = piece
    }
  }
  if (current) chunks.push(current)

  if (overlapTokens <= 0 || chunks.length < 2) return chunks
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk
    const prevTokens = encode(chunks[i - 1])
    const tail = decode(prevTokens.slice(-overlapTokens)).trim()
    return tail ? `${tail} ${chunk}` : chunk
  })
}

/**
 * Chunks a document according to a (pre-validated) ChunkConfig.
 * Parent-child: parents split at parentMaxTokens (no overlap, like Dify),
 * children split inside each parent at childMaxTokens, carrying parentText.
 */
export function chunkDocument(text: string, config: ChunkConfig): Chunk[] {
  const cleaned = preprocess(text, config.preprocessing)
  if (!cleaned) return []
  const separator = normalizeSeparator(config.separator)

  if (config.mode === 'general') {
    return chunkGeneral(cleaned, separator, config.maxTokens, config.overlapTokens).map(
      (t) => ({ text: t }),
    )
  }

  // parent-child — schema guarantees both sizes are present
  const parents = chunkGeneral(cleaned, separator, config.parentMaxTokens!, 0)
  const out: Chunk[] = []
  for (const parent of parents) {
    for (const child of chunkGeneral(parent, separator, config.childMaxTokens!, 0)) {
      out.push({ text: child, parentText: parent })
    }
  }
  return out
}
