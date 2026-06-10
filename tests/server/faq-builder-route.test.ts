// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'

const { auth, extractPages, extractDocxText, generateFaqPairs, insertReturning, insertValues } =
  vi.hoisted(() => ({
    auth: vi.fn(),
    extractPages: vi.fn(),
    extractDocxText: vi.fn(),
    generateFaqPairs: vi.fn(),
    insertReturning: vi.fn(),
    insertValues: vi.fn(),
  }))

vi.mock('@/server/auth', () => ({ auth }))
vi.mock('@/server/embed-test/extract', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  extractPages,
}))
vi.mock('@/server/faq/extract-docx', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  extractDocxText,
}))
vi.mock('@/server/faq/claude', () => ({ generateFaqPairs }))
vi.mock('@/server/claude-core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createAnthropicClient: vi.fn(() => ({})),
}))
vi.mock('@/server/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: insertValues.mockImplementation(() => ({ returning: insertReturning })),
    })),
  },
}))

import { ClaudeOutputTruncatedError } from '@/server/claude-core'
import { PdfUnreadableError } from '@/server/embed-test/extract'
import { DocxUnreadableError } from '@/server/faq/extract-docx'
import { POST } from '@/app/api/admin/faq-builder/route'

const ADMIN = { user: { id: 'a1', role: 'admin' } }
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // "%PDF-"
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]) // "PK\x03\x04"

function request(name: string, bytes: Uint8Array<ArrayBuffer>): Request {
  const form = new FormData()
  form.set('file', new File([bytes], name))
  return new Request('http://test/api/admin/faq-builder', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  auth.mockResolvedValue(ADMIN)
  extractPages.mockResolvedValue({ pages: ['x'.repeat(300)], totalPages: 1 })
  extractDocxText.mockResolvedValue('y'.repeat(300))
  generateFaqPairs.mockResolvedValue({
    data: [{ question: 'Q ?', answer: 'R.' }],
    usage: { inputTokens: 1, outputTokens: 1 },
  })
  insertReturning.mockResolvedValue([{ id: 'draft-1' }])
})

test('non connecté → 401, non admin → 403', async () => {
  auth.mockResolvedValueOnce(null)
  expect((await POST(request('a.pdf', PDF_BYTES))).status).toBe(401)
  auth.mockResolvedValueOnce({ user: { id: 'u1', role: 'employee' } })
  expect((await POST(request('a.pdf', PDF_BYTES))).status).toBe(403)
})

test('clé API absente → 503', async () => {
  delete process.env.ANTHROPIC_API_KEY
  expect((await POST(request('a.pdf', PDF_BYTES))).status).toBe(503)
})

test('extension ou magic bytes invalides → 415', async () => {
  expect((await POST(request('a.txt', PDF_BYTES))).status).toBe(415)
  expect((await POST(request('a.pdf', DOCX_BYTES))).status).toBe(415)
  expect((await POST(request('a.docx', PDF_BYTES))).status).toBe(415)
})

test('texte extrait < 200 caractères → 422 empty_text', async () => {
  extractPages.mockResolvedValue({ pages: ['court'], totalPages: 1 })
  const res = await POST(request('a.pdf', PDF_BYTES))
  expect(res.status).toBe(422)
  expect(await res.json()).toEqual({ error: 'empty_text' })
})

test('PDF valide → extraction unpdf, génération, 201 avec id', async () => {
  const res = await POST(request('doc.pdf', PDF_BYTES))
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ id: 'draft-1', count: 1 })
  expect(extractPages).toHaveBeenCalled()
  expect(extractDocxText).not.toHaveBeenCalled()
  expect(insertValues).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceFilename: 'doc.pdf',
      sourceText: expect.stringContaining('x'),
      items: [
        expect.objectContaining({
          question: 'Q ?',
          answer: 'R.',
          origin: 'generated',
          id: expect.any(String),
        }),
      ],
    }),
  )
})

test('docx valide → extraction mammoth, 201', async () => {
  const res = await POST(request('doc.docx', DOCX_BYTES))
  expect(res.status).toBe(201)
  expect(extractDocxText).toHaveBeenCalled()
  expect(extractPages).not.toHaveBeenCalled()
})

test('génération Claude en échec → 502 generation_failed, pas de brouillon créé', async () => {
  generateFaqPairs.mockRejectedValue(new Error('boom'))
  const res = await POST(request('doc.pdf', PDF_BYTES))
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'generation_failed' })
  expect(insertReturning).not.toHaveBeenCalled()
})

test('PDF illisible → 422 unreadable_document', async () => {
  extractPages.mockRejectedValue(new PdfUnreadableError())
  const res = await POST(request('a.pdf', PDF_BYTES))
  expect(res.status).toBe(422)
  expect(await res.json()).toEqual({ error: 'unreadable_document' })
})

test('docx illisible → 422 unreadable_document', async () => {
  extractDocxText.mockRejectedValue(new DocxUnreadableError())
  const res = await POST(request('a.docx', DOCX_BYTES))
  expect(res.status).toBe(422)
  expect(await res.json()).toEqual({ error: 'unreadable_document' })
})

test('fichier trop gros → 413 ; form sans fichier → 400', async () => {
  const big = new Uint8Array(25 * 1024 * 1024 + 1)
  big.set(PDF_BYTES)
  expect((await POST(request('a.pdf', big))).status).toBe(413)
  const form = new FormData()
  const res = await POST(
    new Request('http://test/api/admin/faq-builder', { method: 'POST', body: form }),
  )
  expect(res.status).toBe(400)
})

test('sortie Claude tronquée (max_tokens) → 502 output_truncated', async () => {
  generateFaqPairs.mockRejectedValue(new ClaudeOutputTruncatedError())
  const res = await POST(request('doc.pdf', PDF_BYTES))
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'output_truncated' })
})
