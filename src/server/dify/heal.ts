/**
 * Decides whether a non-ok Dify response on an EXISTING conversation should
 * trigger the auto-heal (reset stored conversation id + retry once).
 *
 * Dify returns 400 for many causes unrelated to the conversation (bad input,
 * app misconfiguration, provider quota): resetting in those cases destroys
 * the user's conversation context for nothing. We keep the historical
 * heal-by-default for everything else (404 Conversation Not Exists, 400
 * model-pinned-to-conversation, unparseable bodies).
 */
const NON_CONVERSATION_CODES = new Set([
  'invalid_param',
  'app_unavailable',
  'provider_not_initialize',
  'provider_quota_exceeded',
])

export function shouldResetConversation(status: number, bodyText: string): boolean {
  if (status === 404) return true
  if (status !== 400) return false
  try {
    const parsed = JSON.parse(bodyText) as { code?: unknown }
    if (typeof parsed.code === 'string' && NON_CONVERSATION_CODES.has(parsed.code)) {
      return false
    }
  } catch {
    // Unparseable body: keep the heal-by-default behaviour.
  }
  return true
}
