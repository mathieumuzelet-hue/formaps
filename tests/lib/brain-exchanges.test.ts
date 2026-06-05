import { expect, test } from 'vitest'

import { groupExchanges } from '@/lib/brain/exchanges'
import type { BrainMessage } from '@/lib/brain/useBrainChat'

const user = (text: string): BrainMessage => ({ role: 'user', text })
const ai = (text: string): BrainMessage => ({ role: 'ai', text })

test('groupe une question et sa réponse dans le même échange', () => {
  expect(groupExchanges([user('q1'), ai('r1')])).toEqual([[user('q1'), ai('r1')]])
})

test('chaque nouvelle question ouvre un nouvel échange', () => {
  expect(groupExchanges([user('q1'), ai('r1'), user('q2'), ai('r2')])).toEqual([
    [user('q1'), ai('r1')],
    [user('q2'), ai('r2')],
  ])
})

test("une réponse sans question précédente forme son propre échange", () => {
  expect(groupExchanges([ai('hello')])).toEqual([[ai('hello')]])
})

test('question en attente de réponse = échange à un seul message', () => {
  expect(groupExchanges([user('q1'), ai('r1'), user('q2')])).toEqual([
    [user('q1'), ai('r1')],
    [user('q2')],
  ])
})

test('liste vide → aucun échange', () => {
  expect(groupExchanges([])).toEqual([])
})
