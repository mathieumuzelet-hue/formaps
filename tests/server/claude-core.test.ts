import { expect, test } from 'vitest'

import {
  ClaudeOutputTruncatedError,
  forcedToolCall,
  type AnthropicLike,
} from '@/server/claude-core'

const SCHEMA = { type: 'object' as const, properties: {}, required: [], additionalProperties: false }

function clientWith(response: unknown): AnthropicLike {
  return { messages: { create: async () => response } }
}

test('stop_reason max_tokens → ClaudeOutputTruncatedError', async () => {
  const client = clientWith({
    content: [{ type: 'tool_use', input: { pairs: [] } }],
    usage: { input_tokens: 1, output_tokens: 16000 },
    stop_reason: 'max_tokens',
  })
  await expect(forcedToolCall(client, 'm', 'p', 't', 'd', SCHEMA)).rejects.toBeInstanceOf(
    ClaudeOutputTruncatedError,
  )
})

test('stop_reason tool_use (ou absent) → passe', async () => {
  const ok = {
    content: [{ type: 'tool_use', input: { x: 1 } }],
    usage: { input_tokens: 1, output_tokens: 2 },
    stop_reason: 'tool_use',
  }
  await expect(forcedToolCall(clientWith(ok), 'm', 'p', 't', 'd', SCHEMA)).resolves.toMatchObject({
    input: { x: 1 },
  })
  const legacy = {
    content: [{ type: 'tool_use', input: { x: 2 } }],
    usage: { input_tokens: 1, output_tokens: 2 },
  }
  await expect(
    forcedToolCall(clientWith(legacy), 'm', 'p', 't', 'd', SCHEMA),
  ).resolves.toMatchObject({ input: { x: 2 } })
})
