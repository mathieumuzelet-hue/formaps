import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { sendFeedback, streamChat } from '@/server/dify/client'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  process.env.DIFY_API_URL = 'http://dify:5001/v1'
  process.env.DIFY_API_KEY = 'app-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('POST sur /v1/messages/{id}/feedbacks avec rating + user, sans double /v1', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

  await sendFeedback({ messageId: 'msg-7', rating: 'like', user: 'u1' })

  expect(fetchMock).toHaveBeenCalledWith(
    'http://dify:5001/v1/messages/msg-7/feedbacks',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer app-key' }),
      body: JSON.stringify({ rating: 'like', user: 'u1' }),
    }),
  )
})

test('réponse non-ok → throw (le caller décide du best-effort)', async () => {
  fetchMock.mockResolvedValue(new Response('nope', { status: 400 }))
  await expect(
    sendFeedback({ messageId: 'msg-7', rating: 'dislike', user: 'u1' }),
  ).rejects.toThrow()
})

test('env manquante → throw', async () => {
  delete process.env.DIFY_API_URL
  await expect(
    sendFeedback({ messageId: 'm', rating: 'like', user: 'u' }),
  ).rejects.toThrow()
})

test('sendFeedback est borné par un timeout (signal présent)', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

  await sendFeedback({ messageId: 'm1', rating: 'like', user: 'u' })

  const init = fetchMock.mock.calls[0][1] as RequestInit
  expect(init.signal).toBeInstanceOf(AbortSignal)
})

describe('streamChat', () => {
  test('transmet le signal du caller au fetch', async () => {
    fetchMock.mockResolvedValue(new Response('ok'))
    const controller = new AbortController()

    await streamChat({ query: 'q', user: 'u', signal: controller.signal })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBe(controller.signal)
  })

  test('sans signal fourni → fetch sans signal (les longues générations ne sont jamais coupées ici)', async () => {
    fetchMock.mockResolvedValue(new Response('ok'))

    await streamChat({ query: 'q', user: 'u' })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal == null).toBe(true)
  })
})
