/**
 * Validates raw SSE JSON payloads from /api/admin/embed-test into typed
 * EmbedTestEvent objects. Pure and client-safe — same convention as
 * lib/dify/parse. Returns null on anything malformed (never throws).
 */
import { z } from 'zod'

import { chunkConfigSchema, type EmbedTestEvent } from '@/lib/embed-test/types'

const configResultSchema = z.object({
  index: z.number().int().min(0),
  score: z.number(),
  issues: z.array(z.string()),
  summary: z.string(),
  chunkCount: z.number().int().min(0),
  failed: z.boolean().optional(),
})

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), id: z.string(), label: z.string() }),
  z.object({ type: z.literal('configs'), items: z.array(chunkConfigSchema) }),
  z.object({ type: z.literal('config-result'), result: configResultSchema }),
  z.object({
    type: z.literal('diagnostic'),
    diagnostic: z.object({
      totalChars: z.number(),
      paragraphBreaks: z.number(),
      lineBreaks: z.number(),
      avgParagraphTokens: z.number(),
      shortLineRatio: z.number(),
      verdict: z.enum(['structured', 'weakly_structured', 'flat']),
      notes: z.array(z.string()),
    }),
  }),
  z.object({
    type: z.literal('report'),
    report: z.object({
      ocr: z.object({
        verdict: z.enum(['text_ok', 'ocr_needed']),
        reason: z.string(),
        coverage: z.number(),
      }),
      ranking: z.array(z.number().int()),
      recommendation: z.object({
        configIndex: z.number().int(),
        difySettings: z.string(),
        rationale: z.string(),
      }),
      usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
    }),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
])

export function parseEmbedTestEvent(payload: string): EmbedTestEvent | null {
  let obj: unknown
  try {
    obj = JSON.parse(payload)
  } catch {
    return null
  }
  const parsed = eventSchema.safeParse(obj)
  return parsed.success ? parsed.data : null
}
