/**
 * Server-only Dify chat client. MUST NOT be imported from middleware (Edge) or
 * client components — it reads server env and is meant for the Node runtime.
 */

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
  const apiUrl = process.env.DIFY_API_URL
  const apiKey = process.env.DIFY_API_KEY
  if (!apiUrl || !apiKey) {
    throw new Error('DIFY_API_URL and DIFY_API_KEY must be set')
  }

  return fetch(`${apiUrl}/v1/chat-messages`, {
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
