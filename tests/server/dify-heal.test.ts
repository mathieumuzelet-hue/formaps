import { describe, expect, test } from 'vitest'

import { shouldResetConversation } from '@/server/dify/heal'

describe('shouldResetConversation', () => {
  test('404 → reset (Conversation Not Exists)', () => {
    expect(shouldResetConversation(404, '{"code":"not_found"}')).toBe(true)
  })

  test('400 code conversation-agnostique → PAS de reset', () => {
    for (const code of [
      'invalid_param',
      'app_unavailable',
      'provider_not_initialize',
      'provider_quota_exceeded',
    ]) {
      expect(shouldResetConversation(400, JSON.stringify({ code }))).toBe(false)
    }
  })

  test('400 autre code → reset (comportement historique conservé)', () => {
    expect(shouldResetConversation(400, '{"code":"model_currently_not_support"}')).toBe(true)
  })

  test('400 body non-JSON → reset par défaut', () => {
    expect(shouldResetConversation(400, '<html>oops</html>')).toBe(true)
  })

  test('autres statuts → jamais de reset', () => {
    expect(shouldResetConversation(500, '{}')).toBe(false)
  })
})
