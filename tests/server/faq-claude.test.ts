import { expect, test } from 'vitest'

import type { AnthropicLike } from '@/server/claude-core'
import { FAQ_MODEL, generateFaqPairs, questionKey } from '@/server/faq/claude'

/** Fake Anthropic client returning the given tool_use inputs, call after call. */
function fakeClient(...inputs: unknown[]): AnthropicLike & { calls: unknown[] } {
  const calls: unknown[] = []
  let i = 0
  return {
    calls,
    messages: {
      create: async (params: unknown) => {
        calls.push(params)
        const input = inputs[Math.min(i, inputs.length - 1)]
        i += 1
        return {
          content: [{ type: 'tool_use', input }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }
      },
    },
  }
}

test('questionKey normalise casse, accents, ponctuation et espaces', () => {
  expect(questionKey('  Quand   BASCULE-t-on ?! ')).toBe(questionKey('quand bascule t on'))
  expect(questionKey('Où est la cantine ?')).toBe(questionKey('ou est la cantine'))
})

test('generateFaqPairs valide par paire et déduplique les questions équivalentes', async () => {
  const client = fakeClient({
    pairs: [
      { question: 'Quand bascule-t-on ?', answer: 'À la date J du magasin.' },
      { question: 'QUAND bascule t on', answer: 'Doublon à écarter.' },
      { question: 'Sans réponse', answer: '' }, // invalide → écartée
      { question: 'Comment me former ?', answer: "Via l'Espace Formation." },
    ],
  })
  const { data } = await generateFaqPairs(client, 'texte source')
  expect(data).toEqual([
    { question: 'Quand bascule-t-on ?', answer: 'À la date J du magasin.' },
    { question: 'Comment me former ?', answer: "Via l'Espace Formation." },
  ])
  const params = client.calls[0] as { model: string; tool_choice: { type: string } }
  expect(params.model).toBe(FAQ_MODEL)
  expect(params.tool_choice.type).toBe('tool')
})

test('generateFaqPairs jette si aucune paire valide', async () => {
  const client = fakeClient({ pairs: [{ question: '', answer: '' }] })
  await expect(generateFaqPairs(client, 'texte')).rejects.toThrow(/no valid FAQ pair/)
})

test('le prompt contient le document et les règles autoportantes', async () => {
  const client = fakeClient({ pairs: [{ question: 'Q ?', answer: 'R.' }] })
  await generateFaqPairs(client, 'CONTENU-SENTINELLE')
  const params = client.calls[0] as { messages: [{ content: string }] }
  expect(params.messages[0].content).toContain('CONTENU-SENTINELLE')
  expect(params.messages[0].content).toContain('AUTOPORTANTE')
})
