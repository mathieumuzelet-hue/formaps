import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createQaDocument,
  deleteDocument,
  DifyKnowledgeError,
  knowledgeConfig,
} from '@/server/dify/knowledge'

beforeEach(() => {
  process.env.DIFY_API_URL = 'https://dify.example.com/v1'
  process.env.DIFY_DATASET_API_KEY = 'dataset-key'
})
afterEach(() => vi.restoreAllMocks())

describe('knowledgeConfig', () => {
  test('strips trailing /v1 and reads dataset key', () => {
    expect(knowledgeConfig()).toEqual({ base: 'https://dify.example.com', datasetKey: 'dataset-key' })
  })
  test('throws when key missing', () => {
    delete process.env.DIFY_DATASET_API_KEY
    expect(() => knowledgeConfig()).toThrow()
  })
})

describe('createQaDocument', () => {
  test('creates a document then posts Q&A segments, returns documentId', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/document/create-by-text')) {
        return new Response(JSON.stringify({ document: { id: 'doc-1' } }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const out = await createQaDocument({
      datasetId: 'ds-1',
      name: 'faq.pdf',
      segments: [{ content: 'Q ?', answer: 'R.' }],
      fetchImpl,
    })
    expect(out).toEqual({ documentId: 'doc-1' })
    expect(calls[0].url).toBe('https://dify.example.com/v1/datasets/ds-1/document/create-by-text')
    expect(calls[1].url).toBe('https://dify.example.com/v1/datasets/ds-1/documents/doc-1/segments')
    const seg = JSON.parse(calls[1].init.body as string)
    expect(seg.segments).toEqual([{ content: 'Q ?', answer: 'R.' }])
    const auth = (calls[0].init.headers as Record<string, string>).Authorization
    expect(auth).toBe('Bearer dataset-key')
  })

  test('throws DifyKnowledgeError on non-ok', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    await expect(
      createQaDocument({ datasetId: 'ds', name: 'n', segments: [], fetchImpl }),
    ).rejects.toBeInstanceOf(DifyKnowledgeError)
  })
})

describe('deleteDocument', () => {
  test('DELETEs the document', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    await deleteDocument({ datasetId: 'ds', documentId: 'doc-9', fetchImpl })
    const url = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    expect(url).toBe('https://dify.example.com/v1/datasets/ds/documents/doc-9')
  })
})
