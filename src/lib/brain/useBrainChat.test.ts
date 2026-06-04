import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  reduceFrame,
  splitSSEFrames,
  useBrainChat,
  type BrainMessage,
} from './useBrainChat'

/** Builds a streaming Response whose body emits the given UTF-8 chunks. */
function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const MESSAGE_FRAME = 'data: {"event":"message","answer":"Bonjour"}\n\n'
const END_FRAME =
  'data: {"event":"message_end","conversation_id":"c1","metadata":{"retriever_resources":[{"document_name":"Guide.pdf","position":14,"dataset_name":"Encaissement"}]}}\n\n'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('splitSSEFrames', () => {
  it('keeps an incomplete trailing frame as rest', () => {
    const { frames, rest } = splitSSEFrames('data: a\n\ndata: par')
    expect(frames).toEqual(['data: a'])
    expect(rest).toBe('data: par')
  })

  it('reassembles a frame split across two buffers', () => {
    const first = splitSSEFrames('data: {"event":"mes')
    expect(first.frames).toEqual([])
    const second = splitSSEFrames(first.rest + 'sage","answer":"Hi"}\n\n')
    expect(second.frames).toEqual(['data: {"event":"message","answer":"Hi"}'])
  })
})

describe('reduceFrame', () => {
  it('appends answer deltas and attaches sources', () => {
    const start: BrainMessage = { role: 'ai', text: '' }
    const afterMsg = reduceFrame(start, MESSAGE_FRAME.trimEnd())
    expect(afterMsg.text).toBe('Bonjour')
    const afterEnd = reduceFrame(afterMsg, END_FRAME.trimEnd())
    // `position` is the retrieval rank, not a page → no page key is faked.
    expect(afterEnd.sources).toEqual([
      { doc: 'Guide.pdf', tag: 'Encaissement' },
    ])
  })
})

describe('useBrainChat', () => {
  it('reduces a streamed conversation into messages with sources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse([MESSAGE_FRAME, END_FRAME])),
    )

    const { result } = renderHook(() => useBrainChat())

    await act(async () => {
      await result.current.send('q')
    })

    await waitFor(() => expect(result.current.status).toBe('idle'))

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0]).toMatchObject({ role: 'user', text: 'q' })
    expect(result.current.messages[1]).toMatchObject({
      role: 'ai',
      text: 'Bonjour',
    })
    expect(result.current.messages[1].sources?.[0]).toEqual({
      doc: 'Guide.pdf',
      tag: 'Encaissement',
    })
  })

  it('handles a frame split across network chunks', async () => {
    const mid = Math.floor(MESSAGE_FRAME.length / 2)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamingResponse([
          MESSAGE_FRAME.slice(0, mid),
          MESSAGE_FRAME.slice(mid),
          END_FRAME,
        ]),
      ),
    )

    const { result } = renderHook(() => useBrainChat())
    await act(async () => {
      await result.current.send('q')
    })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    expect(result.current.messages[1].text).toBe('Bonjour')
  })

  it('sets error status when the route fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 502 })),
    )

    const { result } = renderHook(() => useBrainChat())
    await act(async () => {
      await result.current.send('q')
    })
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.messages[1].text).toContain('momentanément')
  })
})
