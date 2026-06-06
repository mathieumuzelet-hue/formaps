/**
 * Typed Claude API calls for the embed-test lab. Server-only.
 *
 * Structured outputs via FORCED tool use (tool_choice type:'tool' + strict
 * input schema): the response is always a tool_use block whose input we
 * validate with zod. The client is injected so tests pass a plain fake.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import {
  chunkConfigSchema,
  configKey,
  type ChunkConfig,
  type EmbedTestModelKey,
  type OcrVerdict,
  type TestedConfig,
} from '@/lib/embed-test/types'
import type { Chunk } from '@/lib/embed-test/chunker'

export const EMBED_TEST_MODELS: Record<EmbedTestModelKey, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
}

/** Structural subset of the Anthropic client used here (test seam). */
export type AnthropicLike = {
  messages: { create: (params: Anthropic.MessageCreateParams) => Promise<unknown> }
}

export function createAnthropicClient(): AnthropicLike {
  // SDK auto-retries 429/5xx with backoff (default maxRetries: 2).
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

export type Usage = { inputTokens: number; outputTokens: number }

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string() }).loose()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
})

async function forcedToolCall(
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
  const block = res.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; input: unknown }
    | undefined
  if (!block) throw new Error('Claude response carried no tool_use block')
  return {
    input: block.input,
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
  }
}

// ---------------------------------------------------------------- ocrCompare

const ocrVerdictSchema = z.object({
  verdict: z.enum(['text_ok', 'ocr_needed']),
  reason: z.string(),
  coverage: z.number().min(0).max(1),
})

const OCR_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['text_ok', 'ocr_needed'] },
    reason: { type: 'string', description: 'Justification en français, 1-3 phrases' },
    coverage: {
      type: 'number',
      description: 'Part (0..1) du contenu lu visuellement présent dans le texte natif',
    },
  },
  required: ['verdict', 'reason', 'coverage'],
  additionalProperties: false,
}

export async function ocrCompare(
  client: AnthropicLike,
  model: string,
  pdfSampleBase64: string,
  nativeText: string,
): Promise<{ data: OcrVerdict; usage: Usage }> {
  const { input, usage } = await forcedToolCall(
    client,
    model,
    [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfSampleBase64 },
      },
      {
        type: 'text',
        text:
          'Lis visuellement les pages de ce PDF, puis compare avec le texte extrait de la ' +
          'couche texte native des MÊMES pages ci-dessous. Si la couche native est vide, ' +
          'tronquée, désordonnée ou incohérente avec ce que tu lis (document scanné, texte ' +
          'en image), le verdict est ocr_needed. Sinon text_ok.\n\n--- TEXTE NATIF ---\n' +
          nativeText,
      },
    ],
    'output',
    'Rapporte le verdict OCR structuré',
    OCR_TOOL_SCHEMA,
  )
  return { data: ocrVerdictSchema.parse(input), usage }
}

// ------------------------------------------------------------ proposeConfigs

const CONFIG_PROPERTIES = {
  label: { type: 'string' },
  mode: { type: 'string', enum: ['general', 'parent-child'] },
  separator: { type: 'string', description: 'Délimiteur, ex "\\n\\n" ou "\\n" ou "###"' },
  maxTokens: { type: 'integer', description: 'Longueur max de chunk en tokens (100-4000)' },
  overlapTokens: { type: 'integer', description: 'Chevauchement en tokens, < maxTokens' },
  parentMaxTokens: { type: 'integer' },
  childMaxTokens: { type: 'integer' },
  preprocessing: {
    type: 'object',
    properties: {
      removeExtraSpaces: { type: 'boolean' },
      removeUrlsEmails: { type: 'boolean' },
    },
    required: ['removeExtraSpaces', 'removeUrlsEmails'],
    additionalProperties: false,
  },
  rationale: { type: 'string' },
} as const

const PROPOSE_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    configs: {
      type: 'array',
      items: {
        type: 'object',
        properties: CONFIG_PROPERTIES,
        required: ['label', 'mode', 'separator', 'maxTokens', 'overlapTokens', 'preprocessing'],
        additionalProperties: false,
      },
    },
  },
  required: ['configs'],
  additionalProperties: false,
}

// Raw envelope only — each entry is validated individually below so one
// invalid config (the refines are inexpressible in the strict JSON tool
// schema) does not fail the whole run.
const proposeEnvelopeSchema = z.object({
  configs: z.array(z.unknown()),
})

/**
 * Compact French line describing an already-tested config — feeds the refine
 * history block so Claude avoids re-proposing it.
 */
function renderTestedConfig(t: TestedConfig): string {
  const sizes =
    t.config.mode === 'general'
      ? `${t.config.maxTokens} tk, overlap ${t.config.overlapTokens}`
      : `parent ${t.config.parentMaxTokens} / enfant ${t.config.childMaxTokens} tk`
  const outcome = t.failed ? 'échec' : `${t.score}/10`
  const issues = t.issues.length > 0 ? ` — problèmes : ${t.issues.join(' ; ')}` : ''
  return `- [tour ${t.round}] "${t.config.label}" (${t.config.mode}, sep "${t.config.separator}", ${sizes}) → ${outcome}${issues}`
}

export async function proposeConfigs(
  client: AnthropicLike,
  model: string,
  textSample: string,
  stats: { totalPages: number; totalChars: number },
  extras?: { diagnosticSummary?: string; tested?: TestedConfig[] },
): Promise<{ data: ChunkConfig[]; usage: Usage }> {
  const diagnosticBlock = extras?.diagnosticSummary
    ? `--- DIAGNOSTIC DU TEXTE EXTRAIT ---\n${extras.diagnosticSummary}\n\n`
    : ''
  const testedBlock =
    extras?.tested && extras.tested.length > 0
      ? '--- CONFIGS DÉJÀ TESTÉES (ne JAMAIS re-proposer une config identique) ---\n' +
        extras.tested.map(renderTestedConfig).join('\n') +
        '\n\nPropose des configurations NOUVELLES qui corrigent les problèmes relevés ci-dessus.\n\n'
      : ''
  const { input, usage } = await forcedToolCall(
    client,
    model,
    "Tu prépares l'ingestion d'un document dans une base de connaissance Dify (RAG). " +
      'Analyse la structure du texte ci-dessous (titres, paragraphes, listes, tableaux, ' +
      `densité). Document : ${stats.totalPages} pages, ${stats.totalChars} caractères. ` +
      'Propose 4 à 6 configurations de chunking PERTINENTES et CONTRASTÉES à tester, ' +
      "alignées sur les options de l'UI Dify (mode Général ou Parent-enfant, délimiteur, " +
      'longueur max en tokens 100-4000, chevauchement < longueur max, prétraitement). ' +
      'En mode parent-child, fournis parentMaxTokens et childMaxTokens.\n\n' +
      diagnosticBlock +
      testedBlock +
      '--- DOCUMENT ---\n' +
      textSample,
    'output',
    'Rapporte les configurations de chunking à tester',
    PROPOSE_TOOL_SCHEMA,
  )
  const envelope = proposeEnvelopeSchema.parse(input)
  const valid: ChunkConfig[] = []
  for (const entry of envelope.configs) {
    const parsed = chunkConfigSchema.safeParse(entry)
    if (parsed.success) valid.push(parsed.data)
  }
  // Drop configs structurally identical to ones already tested in prior rounds.
  const testedKeys = new Set((extras?.tested ?? []).map((t) => configKey(t.config)))
  const fresh = valid.filter((c) => !testedKeys.has(configKey(c)))
  const survivors = fresh.slice(0, 6)
  if (survivors.length < 2) {
    throw new Error('Claude proposed fewer than 2 valid configs')
  }
  return { data: survivors, usage }
}

// --------------------------------------------------------------- judgeConfig

const judgementSchema = z.object({
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
  summary: z.string(),
})

const JUDGE_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    score: { type: 'number', description: 'Note 0-10 de qualité structurelle des chunks' },
    issues: { type: 'array', items: { type: 'string' }, description: 'Problèmes relevés, en français' },
    summary: { type: 'string', description: 'Synthèse 1-2 phrases en français' },
  },
  required: ['score', 'issues', 'summary'],
  additionalProperties: false,
}

export async function judgeConfig(
  client: AnthropicLike,
  model: string,
  configLabel: string,
  chunks: Chunk[],
): Promise<{ data: { score: number; issues: string[]; summary: string }; usage: Usage }> {
  const rendered = chunks
    .map((c, i) => {
      const parent = c.parentText ? `\n[CONTEXTE PARENT]\n${c.parentText}` : ''
      return `=== CHUNK ${i + 1} ===\n${c.text}${parent}`
    })
    .join('\n\n')
  const { input, usage } = await forcedToolCall(
    client,
    model,
    `Évalue la qualité STRUCTURELLE de ce découpage en chunks (config "${configLabel}") ` +
      'pour du retrieval RAG : phrases coupées en plein milieu, idées fragmentées entre ' +
      'chunks, tableaux ou listes cassés, chunks orphelins sans contexte, chunks trop ' +
      'hétérogènes. Note de 0 (inutilisable) à 10 (parfait). Liste les problèmes concrets.\n\n' +
      rendered,
    'output',
    'Rapporte le jugement structuré de la config',
    JUDGE_TOOL_SCHEMA,
  )
  return { data: judgementSchema.parse(input), usage }
}
