/**
 * Shared types for the embed-test lab. Pure module (no node/server imports) —
 * used by the server pipeline AND the client hook, same rule as lib/dify/parse.
 *
 * ChunkConfig mirrors the knobs exposed by the Dify Knowledge UI so the final
 * recommendation maps 1:1 to what the admin sets manually in Dify.
 */
import { z } from 'zod'

import { normalizeSeparator } from '@/lib/embed-test/separator'

export const EMBED_TEST_MODEL_KEYS = ['sonnet', 'opus'] as const
export type EmbedTestModelKey = (typeof EMBED_TEST_MODEL_KEYS)[number]

export const chunkConfigSchema = z
  .object({
    label: z.string().min(1).max(80),
    mode: z.enum(['general', 'parent-child']),
    /** Literal separator; Claude may send escaped forms like "\\n\\n". */
    separator: z.string().min(1).max(20),
    /** Dify UI: "Maximum chunk length" (tokens). */
    maxTokens: z.number().int().min(100).max(4000),
    /** Dify UI: "Chunk overlap" (tokens). */
    overlapTokens: z.number().int().min(0).max(2000),
    parentMaxTokens: z.number().int().min(200).max(8000).optional(),
    childMaxTokens: z.number().int().min(50).max(2000).optional(),
    preprocessing: z.object({
      removeExtraSpaces: z.boolean(),
      removeUrlsEmails: z.boolean(),
    }),
    rationale: z.string().max(500).optional(),
  })
  .refine((c) => c.overlapTokens < c.maxTokens, {
    message: 'overlapTokens must be < maxTokens',
  })
  .refine(
    (c) =>
      c.mode === 'general' ||
      (c.parentMaxTokens !== undefined && c.childMaxTokens !== undefined),
    { message: 'parent-child mode requires parentMaxTokens and childMaxTokens' },
  )
  .refine(
    (c) =>
      c.mode === 'general' ||
      c.parentMaxTokens === undefined ||
      c.childMaxTokens === undefined ||
      c.childMaxTokens < c.parentMaxTokens,
    { message: 'childMaxTokens must be < parentMaxTokens' },
  )

export type ChunkConfig = z.infer<typeof chunkConfigSchema>

/**
 * Identité structurelle d'une config — utilisé pour dédupliquer les
 * propositions de Claude entre tours. Ignore label/rationale volontairement.
 */
// Keep field list in sync with chunkConfigSchema's structural fields.
export function configKey(c: ChunkConfig): string {
  return JSON.stringify([
    c.mode,
    normalizeSeparator(c.separator),
    c.maxTokens,
    c.overlapTokens,
    c.parentMaxTokens ?? null,
    c.childMaxTokens ?? null,
    c.preprocessing.removeExtraSpaces,
    c.preprocessing.removeUrlsEmails,
  ])
}

export type TextDiagnostic = {
  totalChars: number
  /** Occurrences of \n{2,} (paragraph breaks). */
  paragraphBreaks: number
  /** Occurrences of single \n (not part of a paragraph break). */
  lineBreaks: number
  /** 0 when the text has no paragraphs. */
  avgParagraphTokens: number
  /** Lines shorter than 40 chars / non-empty lines (0..1). */
  shortLineRatio: number
  verdict: 'structured' | 'weakly_structured' | 'flat'
  notes: string[]
}

export const testedConfigSchema = z.object({
  config: chunkConfigSchema,
  score: z.number(),
  issues: z.array(z.string()),
  failed: z.boolean().optional(),
  round: z.number().int().min(1),
})
export type TestedConfig = z.infer<typeof testedConfigSchema>

export const refinePayloadSchema = z.object({
  ocr: z.object({
    verdict: z.enum(['text_ok', 'ocr_needed']),
    reason: z.string(),
    coverage: z.number().min(0).max(1),
  }),
  tested: z.array(testedConfigSchema).min(1).max(30),
  /** Optional admin-supplied config: pipeline judges ONLY this, skips propose. */
  manual: chunkConfigSchema.optional(),
})
export type RefinePayload = z.infer<typeof refinePayloadSchema>

export type OcrVerdict = {
  verdict: 'text_ok' | 'ocr_needed'
  reason: string
  /** 0..1 — fraction of visually-read content present in the native text layer. */
  coverage: number
}

export type ConfigResult = {
  index: number
  score: number
  issues: string[]
  summary: string
  chunkCount: number
  failed?: boolean
}

export type EmbedTestReport = {
  ocr: OcrVerdict
  /** Config indices sorted best-first (failed configs excluded). */
  ranking: number[]
  recommendation: { configIndex: number; difySettings: string; rationale: string }
  usage: { inputTokens: number; outputTokens: number }
}

export type EmbedTestEvent =
  | { type: 'step'; id: string; label: string }
  | { type: 'configs'; items: ChunkConfig[] }
  | { type: 'config-result'; result: ConfigResult }
  | { type: 'diagnostic'; diagnostic: TextDiagnostic }
  | { type: 'report'; report: EmbedTestReport }
  | { type: 'error'; code: string; message: string }
