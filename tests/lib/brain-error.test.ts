import { parseDifyEvent } from '@/lib/dify/parse'
import { frameError, difyErrorText } from '@/lib/brain/useBrainChat'
import { expect, test } from 'vitest'

test("parseDifyEvent extrait le message d'un event error", () => {
  const e = parseDifyEvent(JSON.stringify({ event: 'error', status: 400, message: 'boom' }))
  expect(e.error).toBe('boom')
})

test('frameError trouve une erreur dans une frame SSE', () => {
  const frame = 'data: {"event":"error","message":"Service tier capacity exceeded"}'
  expect(frameError(frame)).toBe('Service tier capacity exceeded')
})

test('frameError = undefined sur une frame normale', () => {
  const frame = 'data: {"event":"message","answer":"Bonjour"}'
  expect(frameError(frame)).toBeUndefined()
})

test('difyErrorText : capacité dépassée → message court', () => {
  expect(difyErrorText('... Service tier capacity exceeded ... 429')).toMatch(/surchargé/i)
})

test('difyErrorText : erreur générique → message générique sans JSON brut', () => {
  const t = difyErrorText('{"some":"raw nested json"}')
  expect(t).toMatch(/erreur du modèle/i)
  expect(t).not.toContain('{')
})
