import { expect, test } from 'vitest'

import type { AnthropicLike } from '@/server/claude-core'
import { FAQ_MODEL, generateFaqPairs, generateMorePairs, questionKey } from '@/server/faq/claude'

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

test('generateMorePairs écarte les questions déjà présentes (modulo normalisation)', async () => {
  const client = fakeClient({
    pairs: [
      { question: 'Quand bascule-t-on ?', answer: 'Déjà présente.' },
      { question: 'Où trouver mon planning ?', answer: 'Nouvelle.' },
    ],
  })
  const { data } = await generateMorePairs(client, 'doc', ['QUAND bascule t on !'])
  expect(data).toEqual([{ question: 'Où trouver mon planning ?', answer: 'Nouvelle.' }])
  expect(client.calls).toHaveLength(1)
})

test('generateMorePairs : tout doublon → un retry listant les rejets', async () => {
  const client = fakeClient(
    { pairs: [{ question: 'Quand bascule-t-on ?', answer: 'Doublon.' }] },
    { pairs: [{ question: 'Qui contacter en cas de souci ?', answer: 'Le référent.' }] },
  )
  const { data } = await generateMorePairs(client, 'doc', ['Quand bascule-t-on ?'])
  expect(data).toEqual([
    { question: 'Qui contacter en cas de souci ?', answer: 'Le référent.' },
  ])
  expect(client.calls).toHaveLength(2)
  const retry = client.calls[1] as { messages: [{ content: string }] }
  expect(retry.messages[0].content).toContain('PROPOSITIONS REJETÉES')
  expect(retry.messages[0].content).toContain('Quand bascule-t-on ?')
})

test('generateMorePairs : retry encore en doublon → erreur explicite', async () => {
  const client = fakeClient(
    { pairs: [{ question: 'Quand bascule-t-on ?', answer: 'Doublon.' }] },
    { pairs: [{ question: 'quand bascule t on', answer: 'Encore doublon.' }] },
  )
  await expect(generateMorePairs(client, 'doc', ['Quand bascule-t-on ?'])).rejects.toThrow(
    /no new FAQ pair/,
  )
  expect(client.calls).toHaveLength(2)
})

test('source > 400k caractères → tronquée avec note dans le prompt', async () => {
  const client = fakeClient({ pairs: [{ question: 'Q ?', answer: 'R.' }] })
  await generateFaqPairs(client, 'x'.repeat(400_001))
  const params = client.calls[0] as { messages: [{ content: string }] }
  expect(params.messages[0].content).toContain('document tronqué aux 400000 premiers caractères')
  expect(params.messages[0].content.length).toBeLessThan(403_000)
})

test('le prompt de generateMorePairs liste les questions existantes', async () => {
  const client = fakeClient({ pairs: [{ question: 'Neuve ?', answer: 'Oui.' }] })
  await generateMorePairs(client, 'doc', ['Question existante A'])
  const params = client.calls[0] as { messages: [{ content: string }] }
  expect(params.messages[0].content).toContain('QUESTIONS DÉJÀ PRÉSENTES')
  expect(params.messages[0].content).toContain('Question existante A')
})
