/**
 * Shared Claude API core: client factory + forced-tool-use call helper.
 * Server-only. Extracted from the embed-test lab so other admin tools
 * (FAQ builder) reuse the same test seam and structured-output mechanics.
 *
 * Structured outputs via FORCED tool use (tool_choice type:'tool' + strict
 * input schema): the response is always a tool_use block whose input the
 * caller validates with zod. The client is injected so tests pass a fake.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

/** Structural subset of the Anthropic client used here (test seam). */
export type AnthropicLike = {
  messages: { create: (params: Anthropic.MessageCreateParams) => Promise<unknown> }
}

export function createAnthropicClient(): AnthropicLike {
  // SDK auto-retries 429/5xx with backoff (default maxRetries: 2).
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

export type Usage = { inputTokens: number; outputTokens: number }

/** The model hit max_tokens mid-output — structured payload is incomplete. */
export class ClaudeOutputTruncatedError extends Error {
  constructor() {
    super('Claude output truncated at max_tokens — structured payload incomplete')
    this.name = 'ClaudeOutputTruncatedError'
  }
}

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string() }).loose()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  stop_reason: z.string().nullish(),
})

export async function forcedToolCall(
  client: AnthropicLike,
  model: string,
  prompt: string | Anthropic.ContentBlockParam[],
  toolName: string,
  description: string,
  inputSchema: Anthropic.Tool.InputSchema,
): Promise<{ input: unknown; usage: Usage }> {
  const raw = await client.messages.create({
    model,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      { name: toolName, description, strict: true, input_schema: inputSchema },
    ],
    tool_choice: { type: 'tool', name: toolName },
  })
  const res = responseSchema.parse(raw)
  if (res.stop_reason === 'max_tokens') throw new ClaudeOutputTruncatedError()
  const block = res.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; input: unknown }
    | undefined
  if (!block) throw new Error('Claude response carried no tool_use block')
  return {
    input: block.input,
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
  }
}
