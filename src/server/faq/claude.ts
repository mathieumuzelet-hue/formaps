/**
 * Claude calls for the FAQ builder. Server-only. Model is FIXED to Sonnet 4.6
 * (spec decision — no selector). Reuses the shared forced-tool-use core.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { forcedToolCall, type AnthropicLike, type Usage } from '@/server/claude-core'

export const FAQ_MODEL = 'claude-sonnet-4-6'

/** Cap on the document text sent to Claude (~110k tokens of French). */
const SOURCE_CHAR_CAP = 400_000

const pairSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(8000),
})
export type FaqPair = z.infer<typeof pairSchema>

const PAIRS_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Question en français, point de vue salarié',
          },
          answer: {
            type: 'string',
            description: 'Réponse autoportante en français',
          },
        },
        required: ['question', 'answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['pairs'],
  additionalProperties: false,
}

// Raw envelope only — each pair is validated individually so one invalid
// entry does not fail the whole batch (same pattern as embed-test).
const envelopeSchema = z.object({ pairs: z.array(z.unknown()) })

/**
 * Normalized dedup key for questions: lowercase, diacritics stripped,
 * punctuation removed, whitespace squeezed. "Ne re-propose pas" in the prompt
 * is not enough — dedup happens in code.
 */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildPrompt(sourceText: string, extraBlocks = ''): string {
  const truncated = sourceText.length > SOURCE_CHAR_CAP
  const text = truncated ? sourceText.slice(0, SOURCE_CHAR_CAP) : sourceText
  const truncNote = truncated
    ? ` (document tronqué aux ${SOURCE_CHAR_CAP} premiers caractères)`
    : ''
  return (
    "Tu prépares la FAQ d'un portail interne pour les salariés d'un supermarché " +
    "A⁺SUPER en pleine bascule d'enseigne Auchan → Intermarché. À partir du document " +
    'ci-dessous, rédige des paires question/réponse en français qui couvrent TOUT le ' +
    `contenu utile du document${truncNote}.\n` +
    'Règles :\n' +
    '- Les questions sont formulées du point de vue d’un salarié (« Comment… ? », ' +
    '« Quand… ? », « Que faire si… ? »).\n' +
    '- Chaque réponse est AUTOPORTANTE : elle sera lue seule, sans le document — ' +
    'aucune référence du type « voir la section X » ou « comme indiqué ci-dessus », ' +
    'sigles développés à leur première occurrence.\n' +
    '- Autant de paires que le contenu le justifie : couvre chaque sujet distinct, ' +
    "sans inventer ce qui n'est pas dans le document.\n\n" +
    extraBlocks +
    '--- DOCUMENT ---\n' +
    text
  )
}

type Attempt = { fresh: FaqPair[]; duplicates: FaqPair[]; usage: Usage }

/** One forced tool call + per-pair safeParse + dedup vs `existingKeys`. */
async function pairsAttempt(
  client: AnthropicLike,
  prompt: string,
  existingKeys: Set<string>,
): Promise<Attempt> {
  const { input, usage } = await forcedToolCall(
    client,
    FAQ_MODEL,
    prompt,
    'output',
    'Rapporte les paires question/réponse de la FAQ',
    PAIRS_TOOL_SCHEMA,
  )
  const envelope = envelopeSchema.parse(input)
  const fresh: FaqPair[] = []
  const duplicates: FaqPair[] = []
  const seen = new Set(existingKeys)
  for (const entry of envelope.pairs) {
    const parsed = pairSchema.safeParse(entry)
    if (!parsed.success) continue
    const key = questionKey(parsed.data.question)
    if (seen.has(key)) duplicates.push(parsed.data)
    else {
      seen.add(key)
      fresh.push(parsed.data)
    }
  }
  return { fresh, duplicates, usage }
}

export async function generateFaqPairs(
  client: AnthropicLike,
  sourceText: string,
): Promise<{ data: FaqPair[]; usage: Usage }> {
  const { fresh, usage } = await pairsAttempt(client, buildPrompt(sourceText), new Set())
  if (fresh.length < 1) throw new Error('Claude returned no valid FAQ pair')
  return { data: fresh, usage }
}

export async function generateMorePairs(
  client: AnthropicLike,
  sourceText: string,
  existingQuestions: string[],
): Promise<{ data: FaqPair[]; usage: Usage }> {
  const existingKeys = new Set(existingQuestions.map(questionKey))
  const existingBlock =
    '--- QUESTIONS DÉJÀ PRÉSENTES (ne JAMAIS reproposer une question identique ou ' +
    'équivalente) ---\n' +
    existingQuestions.map((q) => `- ${q}`).join('\n') +
    '\n\nPropose uniquement des paires INÉDITES sur des sujets du document non ' +
    'couverts ci-dessus.\n\n'

  const first = await pairsAttempt(client, buildPrompt(sourceText, existingBlock), existingKeys)
  if (first.fresh.length >= 1) return { data: first.fresh, usage: first.usage }

  // Everything came back as a duplicate: one retry with explicit feedback.
  // (No attempt-1 survivors to rescue here — the retry only fires at 0 fresh.)
  const feedbackBlock =
    '--- ATTENTION : PROPOSITIONS REJETÉES ---\n' +
    `Tu viens de proposer ${first.duplicates.length} question(s) déjà présentes : ` +
    first.duplicates.map((p) => `« ${p.question} »`).join(', ') +
    ".\nPropose des questions portant sur D'AUTRES SUJETS du document.\n\n"
  const second = await pairsAttempt(
    client,
    buildPrompt(sourceText, existingBlock + feedbackBlock),
    existingKeys,
  )
  const usage: Usage = {
    inputTokens: first.usage.inputTokens + second.usage.inputTokens,
    outputTokens: first.usage.outputTokens + second.usage.outputTokens,
  }
  if (second.fresh.length < 1) throw new Error('Claude returned no new FAQ pair after retry')
  return { data: second.fresh, usage }
}
