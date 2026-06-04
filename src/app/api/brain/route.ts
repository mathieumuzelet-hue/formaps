import { eq } from 'drizzle-orm'

import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { users } from '@/server/db/schema'
import { streamChat } from '@/server/dify/client'
import { parseDifyEvent, parseSSELines } from '@/lib/dify/parse'

export const runtime = 'nodejs'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user) {
    return json({ error: 'unauthorized' }, 401)
  }
  const userId = session.user.id

  let query: string
  try {
    const body = (await request.json()) as { query?: unknown }
    if (typeof body.query !== 'string' || body.query.trim() === '') {
      return json({ error: 'query is required' }, 400)
    }
    query = body.query
  } catch {
    return json({ error: 'invalid body' }, 400)
  }

  // Load the user's existing Dify conversation id (if any).
  let conversationId: string | null = null
  try {
    const [row] = await db
      .select({ difyConversationId: users.difyConversationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    conversationId = row?.difyConversationId ?? null
  } catch {
    // Non-fatal: proceed without a conversation id (starts a new conversation).
    conversationId = null
  }

  let upstream: Response
  try {
    upstream = await streamChat({ query, user: userId, conversationId })
  } catch (err) {
    console.error('[brain] Dify fetch a échoué (réseau/URL ?):', err)
    return json({ error: 'dify_unavailable' }, 502)
  }

  if (!upstream.ok || !upstream.body) {
    let detail = ''
    try {
      detail = (await upstream.text()).slice(0, 500)
    } catch {
      /* ignore */
    }
    console.error(`[brain] Dify a répondu ${upstream.status}: ${detail}`)
    return json({ error: 'dify_unavailable', status: upstream.status }, 502)
  }

  // Relay the SSE stream untouched, while inspecting chunks to capture the
  // `conversation_id` Dify assigns. We do NOT buffer the *response*: each chunk
  // is enqueued unchanged immediately. We DO keep a small text buffer for the
  // inspection side, so a `data:` frame split across two network chunks still
  // parses (mirrors the client hook's frame buffering).
  const decoder = new TextDecoder()
  const hadConversationId = conversationId != null
  let captured = false
  // Leftover incomplete SSE segment carried over to the next chunk.
  let buffer = ''

  const inspector = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Pass through immediately — never block the client on inspection.
      controller.enqueue(chunk)

      if (hadConversationId || captured) return
      try {
        buffer += decoder.decode(chunk, { stream: true })
        // Only parse up to the last frame delimiter; keep the incomplete tail.
        const lastDelimiter = buffer.lastIndexOf('\n\n')
        if (lastDelimiter === -1) return
        const complete = buffer.slice(0, lastDelimiter)
        buffer = buffer.slice(lastDelimiter + 2)

        for (const payload of parseSSELines(complete)) {
          const parsed = parseDifyEvent(payload)
          if (parsed.conversationId) {
            captured = true
            const newId = parsed.conversationId
            // Fire-and-forget: don't await, don't break the stream on error.
            // Drizzle builders are PromiseLike (no `.catch`), so wrap in
            // Promise.resolve before attaching the rejection handler.
            void Promise.resolve(
              db.update(users).set({ difyConversationId: newId }).where(eq(users.id, userId)),
            ).catch(() => {})
            break
          }
        }
      } catch {
        // Inspection failures must never affect the relayed bytes.
      }
    },
  })

  return new Response(upstream.body.pipeThrough(inspector), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
