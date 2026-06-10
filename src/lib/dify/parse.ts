/**
 * Pure, dependency-free parsing of the Dify chat streaming protocol.
 *
 * Shared by BOTH the server route (M6, src/app/api/brain/route.ts) and the
 * client hook (M7). It MUST NOT import any node/server modules so it can be
 * bundled into a client component.
 */

export type BrainSource = { doc: string; tag?: string; page?: string; content?: string }

/** Max length of a cited passage carried to the UI before truncation. */
const MAX_CONTENT_LEN = 600

export type DifyParsed = {
  answerDelta?: string
  sources?: BrainSource[]
  conversationId?: string
  /** Dify message id (`id` of message_end) — keys the feedback round-trip. */
  messageId?: string
  /** Numeric `score` of each retriever resource (non-numeric entries dropped). */
  scores?: number[]
  /** Set when Dify streams an `error` event (model failure, quota, etc.). */
  error?: string
}

/**
 * Maps Dify `retriever_resources` entries to the cockpit `BrainSource` shape.
 * Tolerant of missing fields.
 */
export function mapSources(resources: Array<Record<string, unknown>>): BrainSource[] {
  return resources.map((r) => {
    const doc = typeof r.document_name === 'string' ? r.document_name : 'Document'

    const rawTag = r.dataset_name ?? r.tag
    const tag = typeof rawTag === 'string' ? rawTag : undefined

    // Only carry a real page: Dify's `page` is often null, and `position` is the
    // retrieval rank, NOT a page number — never derive a page label from it.
    let page: string | undefined
    if (typeof r.page === 'string' && r.page.trim().length > 0) {
      page = r.page.trim()
    } else if (typeof r.page === 'number' && Number.isFinite(r.page)) {
      page = String(r.page)
    }

    // Carry the cited passage, trimmed and truncated for the expandable UI.
    let content: string | undefined
    if (typeof r.content === 'string') {
      const trimmed = r.content.trim()
      if (trimmed.length > 0) {
        content =
          trimmed.length > MAX_CONTENT_LEN
            ? trimmed.slice(0, MAX_CONTENT_LEN) + '…'
            : trimmed
      }
    }

    const source: BrainSource = { doc }
    if (page !== undefined) source.page = page
    if (tag !== undefined) source.tag = tag
    if (content !== undefined) source.content = content
    return source
  })
}

/**
 * Parses a single Dify SSE JSON payload (the part after `data: `).
 * Returns `{}` on invalid JSON or unknown event types — never throws.
 */
export function parseDifyEvent(line: string): DifyParsed {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line) as Record<string, unknown>
  } catch {
    return {}
  }
  if (!obj || typeof obj !== 'object') return {}

  switch (obj.event) {
    case 'message':
    case 'agent_message': {
      const result: DifyParsed = {}
      if (obj.answer !== undefined) {
        result.answerDelta = typeof obj.answer === 'string' ? obj.answer : ''
      }
      if (typeof obj.conversation_id === 'string') {
        result.conversationId = obj.conversation_id
      }
      return result
    }
    case 'message_end': {
      const metadata = (obj.metadata ?? {}) as Record<string, unknown>
      const resources = Array.isArray(metadata.retriever_resources)
        ? (metadata.retriever_resources as Array<Record<string, unknown>>)
        : []
      const result: DifyParsed = {
        sources: mapSources(resources),
        scores: resources
          .map((r) => r.score)
          .filter((s): s is number => typeof s === 'number' && Number.isFinite(s)),
      }
      if (typeof obj.conversation_id === 'string') {
        result.conversationId = obj.conversation_id
      }
      if (typeof obj.id === 'string') {
        result.messageId = obj.id
      }
      return result
    }
    case 'error': {
      const message = typeof obj.message === 'string' ? obj.message : 'error'
      return { error: message }
    }
    default:
      return {}
  }
}

/**
 * Extracts the JSON payloads from `data: ` lines of a raw SSE text chunk.
 * Pure helper used by both server (capture conversation id) and client (M7).
 */
export function parseSSELines(chunk: string): string[] {
  const payloads: string[] = []
  for (const line of chunk.split('\n')) {
    const trimmed = line.replace(/\r$/, '')
    if (trimmed.startsWith('data:')) {
      // SSE spec: the field value starts after 'data:' plus ONE optional space.
      payloads.push(trimmed.slice(5).replace(/^ /, ''))
    }
  }
  return payloads
}
