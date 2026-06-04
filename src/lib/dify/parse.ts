/**
 * Pure, dependency-free parsing of the Dify chat streaming protocol.
 *
 * Shared by BOTH the server route (M6, src/app/api/brain/route.ts) and the
 * client hook (M7). It MUST NOT import any node/server modules so it can be
 * bundled into a client component.
 */

export type BrainSource = { doc: string; tag?: string; page?: string }

export type DifyParsed = {
  answerDelta?: string
  sources?: BrainSource[]
  conversationId?: string
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
    const position = r.position
    const page = position != null ? `p. ${position}` : undefined
    const rawTag = r.dataset_name ?? r.tag
    const tag = typeof rawTag === 'string' ? rawTag : undefined
    const source: BrainSource = { doc }
    if (page !== undefined) source.page = page
    if (tag !== undefined) source.tag = tag
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
      const result: DifyParsed = { sources: mapSources(resources) }
      if (typeof obj.conversation_id === 'string') {
        result.conversationId = obj.conversation_id
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
    if (trimmed.startsWith('data: ')) {
      payloads.push(trimmed.slice('data: '.length))
    }
  }
  return payloads
}
