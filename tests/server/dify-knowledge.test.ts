import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createDocumentByFile,
  createQaCsvDocument,
  deleteDocument,
  DifyKnowledgeError,
  knowledgeConfig,
  updateDocumentByFile,
  updateQaCsvDocument,
} from '@/server/dify/knowledge'

beforeEach(() => {
  process.env.DIFY_API_URL = 'https://dify.example.com/v1'
  process.env.DIFY_DATASET_API_KEY = 'dataset-key'
})
afterEach(() => vi.restoreAllMocks())

describe('DifyKnowledgeError', () => {
  test('includes the (truncated) response body in the message for observability', () => {
    const err = new DifyKnowledgeError(404, 'Dataset not found')
    expect(err.message).toBe('Dify knowledge API failed: 404 - Dataset not found')
    expect(err.status).toBe(404)
  })
  test('omits the separator when body is empty', () => {
    expect(new DifyKnowledgeError(500, '').message).toBe('Dify knowledge API failed: 500')
  })
})

describe('knowledgeConfig', () => {
  test('strips trailing /v1 and reads dataset key', () => {
    expect(knowledgeConfig()).toEqual({ base: 'https://dify.example.com', datasetKey: 'dataset-key' })
  })
  test('throws when key missing', () => {
    delete process.env.DIFY_DATASET_API_KEY
    expect(() => knowledgeConfig()).toThrow()
  })
  test('throws when url missing', () => {
    delete process.env.DIFY_API_URL
    expect(() => knowledgeConfig()).toThrow()
  })
})

describe('createQaCsvDocument', () => {
  test('uploads the CSV via create-by-file with doc_form qa_model, returns documentId', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ document: { id: 'doc-1' } }), { status: 200 })
    }) as unknown as typeof fetch

    const out = await createQaCsvDocument({
      datasetId: 'ds-1',
      name: 'faq.csv',
      csv: 'question,answer\r\nQ ?,R.\r\n',
      fetchImpl,
    })
    expect(out).toEqual({ documentId: 'doc-1' })
    expect(captured!.url).toBe('https://dify.example.com/v1/datasets/ds-1/document/create-by-file')
    expect(captured!.init.body).toBeInstanceOf(FormData)
    const fd = captured!.init.body as FormData
    const data = JSON.parse(fd.get('data') as string)
    expect(data.doc_form).toBe('qa_model')
    expect(data.doc_language).toBe('French') // défaut : Dify génère les Q&A dans cette langue
    expect(data.name).toBe('faq.csv')
    const file = fd.get('file') as File
    expect(file).toBeInstanceOf(Blob)
    expect(file.name).toBe('faq.csv')
    expect(await file.text()).toBe('question,answer\r\nQ ?,R.\r\n')
    // pas de Content-Type manuel : FormData pose le boundary lui-même
    expect((captured!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe('Bearer dataset-key')
  })

  test('doc_language is overridable via DIFY_QA_DOC_LANGUAGE', async () => {
    process.env.DIFY_QA_DOC_LANGUAGE = 'Français'
    let captured: RequestInit | null = null
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init
      return new Response(JSON.stringify({ document: { id: 'd' } }), { status: 200 })
    }) as unknown as typeof fetch
    await createQaCsvDocument({ datasetId: 'ds', name: 'n.csv', csv: 'question,answer\r\n', fetchImpl })
    const data = JSON.parse((captured!.body as FormData).get('data') as string)
    expect(data.doc_language).toBe('Français')
    delete process.env.DIFY_QA_DOC_LANGUAGE
  })

  test('throws DifyKnowledgeError on non-ok', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    await expect(
      createQaCsvDocument({ datasetId: 'ds', name: 'n.csv', csv: 'question,answer\r\n', fetchImpl }),
    ).rejects.toBeInstanceOf(DifyKnowledgeError)
  })

  test('throws when response has no document id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch
    await expect(
      createQaCsvDocument({ datasetId: 'ds', name: 'n.csv', csv: 'x', fetchImpl }),
    ).rejects.toBeInstanceOf(DifyKnowledgeError)
  })
})

describe('updateQaCsvDocument', () => {
  test('uploads the CSV via update-by-file with doc_form qa_model', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ document: { id: 'doc-1' } }), { status: 200 })
    }) as unknown as typeof fetch

    await updateQaCsvDocument({
      datasetId: 'ds-1',
      documentId: 'doc-1',
      name: 'faq.csv',
      csv: 'question,answer\r\nQ ?,R.\r\n',
      fetchImpl,
    })
    expect(captured!.url).toBe('https://dify.example.com/v1/datasets/ds-1/documents/doc-1/update-by-file')
    const fd = captured!.init.body as FormData
    expect(JSON.parse(fd.get('data') as string).doc_form).toBe('qa_model')
    expect((fd.get('file') as File).name).toBe('faq.csv')
  })
})

describe('createDocumentByFile', () => {
  test('posts multipart with data + file, returns documentId', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ document: { id: 'doc-f' } }), { status: 200 })
    }) as unknown as typeof fetch
    const out = await createDocumentByFile({
      datasetId: 'ds', name: 'cours.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), fetchImpl,
    })
    expect(out).toEqual({ documentId: 'doc-f' })
    expect(captured!.url).toBe('https://dify.example.com/v1/datasets/ds/document/create-by-file')
    expect(captured!.init.body).toBeInstanceOf(FormData)
    const fd = captured!.init.body as FormData
    expect(JSON.parse(fd.get('data') as string).name).toBe('cours.pdf')
    expect(fd.get('file')).toBeInstanceOf(Blob)
    // pas de Content-Type manuel : FormData le pose lui-même (boundary)
    expect((captured!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })
})

describe('updateDocumentByFile', () => {
  test('posts multipart to update-by-file endpoint', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ document: { id: 'doc-f' } }), { status: 200 })
    }) as unknown as typeof fetch
    await updateDocumentByFile({
      datasetId: 'ds', documentId: 'doc-f', name: 'cours.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), fetchImpl,
    })
    expect(captured!.url).toBe('https://dify.example.com/v1/datasets/ds/documents/doc-f/update-by-file')
    expect(captured!.init.body).toBeInstanceOf(FormData)
  })
})

describe('deleteDocument', () => {
  test('DELETEs the document', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    await deleteDocument({ datasetId: 'ds', documentId: 'doc-9', fetchImpl })
    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(call[0]).toBe('https://dify.example.com/v1/datasets/ds/documents/doc-9')
    expect((call[1] as RequestInit).method).toBe('DELETE')
  })

  test('throws DifyKnowledgeError on non-ok', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    await expect(
      deleteDocument({ datasetId: 'ds', documentId: 'doc-9', fetchImpl }),
    ).rejects.toBeInstanceOf(DifyKnowledgeError)
  })
})
