/**
 * Server-only Dify chat client. MUST NOT be imported from middleware (Edge) or
 * client components — it reads server env and is meant for the Node runtime.
 */

/** Resolves env config and the normalized base URL (no trailing slash/v1). */
function difyConfig(): { base: string; apiKey: string } {
  const apiUrl = process.env.DIFY_API_URL
  const apiKey = process.env.DIFY_API_KEY
  if (!apiUrl || !apiKey) {
    throw new Error('DIFY_API_URL and DIFY_API_KEY must be set')
  }
  // Tolerate both base URL forms: Dify shows `https://host/v1` but we append
  // `/v1/...` ourselves — strip a trailing slash and a trailing `/v1`.
  const base = apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  return { base, apiKey }
}

type StreamChatArgs = {
  query: string
  user: string
  conversationId?: string | null
}

/**
 * Opens a streaming chat-messages request to the configured Dify app and
 * returns the raw `Response`. The caller is responsible for relaying
 * `response.body` to the client (SSE pass-through).
 *
 * Throws if `DIFY_API_URL` / `DIFY_API_KEY` are not configured.
 */
export async function streamChat({ query, user, conversationId }: StreamChatArgs): Promise<Response> {
  const { base, apiKey } = difyConfig()

  return fetch(`${base}/v1/chat-messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: {},
      query,
      response_mode: 'streaming',
      user,
      conversation_id: conversationId || undefined,
    }),
  })
}

type SendFeedbackArgs = {
  messageId: string
  rating: 'like' | 'dislike'
  user: string
}

/**
 * Relays a user feedback to Dify so both systems stay consistent. Throws on
 * missing env or non-ok response — callers treat it as best-effort.
 */
export async function sendFeedback({ messageId, rating, user }: SendFeedbackArgs): Promise<void> {
  const { base, apiKey } = difyConfig()
  const res = await fetch(`${base}/v1/messages/${encodeURIComponent(messageId)}/feedbacks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rating, user }),
  })
  if (!res.ok) {
    throw new Error(`Dify feedback failed: ${res.status}`)
  }
}
