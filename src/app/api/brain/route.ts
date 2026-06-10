import { and, eq, isNull } from 'drizzle-orm'

import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { users, chatQueries } from '@/server/db/schema'
import { streamChat } from '@/server/dify/client'
import { shouldResetConversation } from '@/server/dify/heal'
import { parseDifyEvent, parseSSELines } from '@/lib/dify/parse'
import { relevanceThreshold, buildChatQueryValues } from '@/server/brain/chat-log'

export const runtime = 'nodejs'

const CONNECT_TIMEOUT_MS = 30_000

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

  // One controller per attempt: aborts the upstream fetch if the client is
  // already gone, or if Dify accepts the connection but never answers the
  // headers. The timer is cleared as soon as headers arrive so long
  // generations are never cut mid-stream (mid-stream client disconnects are
  // propagated by the pipeThrough cancellation, not by this signal).
  const callDify = async (convId: string | null): Promise<Response> => {
    const controller = new AbortController()
    // A signal aborted before addEventListener never fires the event.
    if (request.signal.aborted) controller.abort()
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort)
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
    try {
      return await streamChat({
        query,
        user: userId,
        conversationId: convId,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
      request.signal.removeEventListener('abort', onAbort)
    }
  }

  let upstream: Response
  try {
    upstream = await callDify(conversationId)
  } catch (err) {
    console.error('[brain] Dify fetch a échoué (réseau/URL ?):', err)
    return json({ error: 'dify_unavailable' }, 502)
  }

  // Auto-heal: an error on an EXISTING conversation usually means the stored
  // conversation id is no longer usable on the Dify side:
  //   - 400: the conversation is pinned to a now-disabled model (Dify snapshots
  //     the model config per conversation, e.g. after changing the model).
  //   - 404 "Conversation Not Exists": the conversation is gone (e.g. the Dify
  //     database was reset/restored).
  // BUT Dify also returns 400 for causes unrelated to the conversation
  // (invalid_param, app_unavailable, provider quota…): the error code is
  // discriminated via shouldResetConversation before destroying the user's
  // context. When the heal applies, clear the stored conversation id and retry
  // ONCE with a fresh conversation, so the user is never stuck. A 404 WITHOUT
  // a conversation id is a real URL/config problem and must surface as an
  // error (no retry).
  if (!upstream.ok && (upstream.status === 400 || upstream.status === 404) && conversationId) {
    // Consume the body: releases the undici socket AND lets us discriminate
    // the Dify error code before destroying the user's conversation context.
    let bodyText = ''
    try {
      bodyText = await upstream.text()
    } catch {
      /* ignore */
    }
    if (!shouldResetConversation(upstream.status, bodyText)) {
      console.error(
        `[brain] Dify ${upstream.status} non lié à la conversation: ${bodyText.slice(0, 500)}`,
      )
      return json({ error: 'dify_unavailable', status: upstream.status }, 502)
    }
    console.warn(
      `[brain] ${upstream.status} sur conversation existante → reset conversation + retry`,
    )
    try {
      await Promise.resolve(
        db.update(users).set({ difyConversationId: null }).where(eq(users.id, userId)),
      )
    } catch {
      // Non-fatal: the retry below starts a new conversation regardless.
    }
    conversationId = null
    try {
      upstream = await callDify(null)
    } catch (err) {
      console.error('[brain] Dify retry a échoué:', err)
      return json({ error: 'dify_unavailable' }, 502)
    }
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

  // Relay the SSE stream untouched, while inspecting frames to capture the
  // conversation id Dify assigns (new conversations), the full answer, and
  // the message_end retrieval metadata for the chat_queries log. Each chunk
  // is enqueued unchanged immediately; only the inspection side buffers.
  const decoder = new TextDecoder()
  const hadConversationId = conversationId != null
  let capturedConversationId = false
  let errorSeen = false
  let buffer = ''

  // Accumulated for the fire-and-forget chat_queries INSERT in flush().
  let answer = ''
  let endMessageId: string | null = null
  let endScores: number[] | null = null
  let streamConversationId = conversationId

  const inspectFrames = (complete: string) => {
    for (const payload of parseSSELines(complete)) {
      const parsed = parseDifyEvent(payload)
      if (parsed.error && !errorSeen) {
        errorSeen = true
        // Self-heal : une erreur in-stream (panne provider, quota) peut laisser
        // un message assistant VIDE dans la conversation Dify, que le provider
        // rejettera ensuite à chaque replay (400 invalid_request_assistant_message)
        // — la conversation est empoisonnée à vie. On purge l'id stocké pour que
        // la prochaine question reparte sur une conversation propre.
        console.warn('[brain] event error dans le stream Dify → purge conversation:', parsed.error)
        void Promise.resolve(
          db.update(users).set({ difyConversationId: null }).where(eq(users.id, userId)),
        ).catch(() => {})
      }
      if (parsed.answerDelta) answer += parsed.answerDelta
      if (parsed.messageId) endMessageId = parsed.messageId
      if (parsed.scores) endScores = parsed.scores
      if (parsed.conversationId) {
        streamConversationId = parsed.conversationId
      }
      // Persist ONLY at message_end (success): persisting on the first delta
      // raced the in-stream error purge (the two fire-and-forget UPDATEs are
      // unordered) and could store a poisoned conversation id.
      // (parsed.messageId is only ever set by message_end — see parse.ts.)
      if (
        parsed.messageId &&
        !hadConversationId &&
        !capturedConversationId &&
        !errorSeen &&
        streamConversationId
      ) {
        capturedConversationId = true
        const newId = streamConversationId
        // Fire-and-forget: don't await, don't break the stream on error.
        void Promise.resolve(
          db
            .update(users)
            .set({ difyConversationId: newId })
            // Write-once: two parallel sends both starting without a stored
            // conversation would otherwise overwrite each other (last write
            // wins, orphaning one Dify conversation). First message_end wins.
            .where(and(eq(users.id, userId), isNull(users.difyConversationId))),
        ).catch(() => {})
      }
    }
  }

  const inspector = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Pass through immediately — never block the client on inspection.
      controller.enqueue(chunk)
      try {
        buffer += decoder.decode(chunk, { stream: true })
        // Only parse up to the last frame delimiter; keep the incomplete tail.
        const lastDelimiter = buffer.lastIndexOf('\n\n')
        if (lastDelimiter === -1) return
        const complete = buffer.slice(0, lastDelimiter)
        buffer = buffer.slice(lastDelimiter + 2)
        inspectFrames(complete)
      } catch {
        // Inspection failures must never affect the relayed bytes.
      }
    },
    flush() {
      try {
        // Parse any trailing frame not terminated by a blank line.
        buffer += decoder.decode()
        if (buffer.trim().length > 0) inspectFrames(buffer)

        // Only log complete answers: a stream without message_end (network
        // cut, model error) is noise for FAQ analysis.
        if (!endMessageId || endScores === null || !streamConversationId) return
        const values = buildChatQueryValues({
          query,
          answer,
          conversationId: streamConversationId,
          messageId: endMessageId,
          userId,
          scores: endScores,
          threshold: relevanceThreshold(process.env.FAQ_RELEVANCE_THRESHOLD),
        })
        // Fire-and-forget: logging must never delay or fail the response.
        void Promise.resolve(db.insert(chatQueries).values(values)).catch((err) => {
          console.error('[brain] log chat_queries a échoué:', err)
        })
      } catch (err) {
        console.error('[brain] inspection finale a échoué:', err)
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
