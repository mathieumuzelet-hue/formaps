// @vitest-environment node
// Node env (precedent: sanitize.test.ts) : jsdom's FormData/File are not
// compatible with undici's Request.formData() parser — every multipart
// request would throw and collapse into a 400 invalid_form.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const auth = vi.fn()
vi.mock('@/server/auth', () => ({ auth: () => auth() }))

const runEmbedTest = vi.fn()
vi.mock('@/server/embed-test/pipeline', () => ({
  runEmbedTest: (...a: unknown[]) => runEmbedTest(...a),
}))

import { POST } from '@/app/api/admin/embed-test/route'

function makeRequest(opts?: { file?: File | null; model?: string }): Request {
  const form = new FormData()
  const file =
    opts?.file === null
      ? undefined
      : (opts?.file ?? new File(['%PDF-1.4 fake'], 'doc.pdf', { type: 'application/pdf' }))
  if (file) form.set('file', file)
  if (opts?.model) form.set('model', opts.model)
  return new Request('http://localhost/api/admin/embed-test', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  auth.mockResolvedValue({ user: { id: 'a1', role: 'admin' } })
  runEmbedTest.mockImplementation(
    async (_buf: unknown, _model: unknown, emit: (e: unknown) => void) => {
      emit({ type: 'step', id: 'extract', label: 'x' })
    },
  )
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
})

describe('POST /api/admin/embed-test — guards', () => {
  test('not authenticated → 401', async () => {
    auth.mockResolvedValue(null)
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  test('employee → 403', async () => {
    auth.mockResolvedValue({ user: { id: 'u1', role: 'employee' } })
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
  })

  test('missing ANTHROPIC_API_KEY → 503 before any work', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const res = await POST(makeRequest())
    expect(res.status).toBe(503)
    expect(runEmbedTest).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/embed-test — validation', () => {
  test('missing file → 400', async () => {
    const res = await POST(makeRequest({ file: null }))
    expect(res.status).toBe(400)
  })

  test('non-pdf → 415', async () => {
    const res = await POST(
      makeRequest({ file: new File(['x'], 'a.txt', { type: 'text/plain' }) }),
    )
    expect(res.status).toBe(415)
  })

  test('unknown model → 400', async () => {
    const res = await POST(makeRequest({ model: 'gpt' }))
    expect(res.status).toBe(400)
  })

  test('non-multipart body → 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/embed-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('oversize file → 413', async () => {
    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'big.pdf', {
      type: 'application/pdf',
    })
    const res = await POST(makeRequest({ file: big }))
    expect(res.status).toBe(413)
  })
})

describe('POST /api/admin/embed-test — SSE', () => {
  test('valid request streams events and defaults to sonnet', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const body = await res.text()
    expect(body).toContain('data: ')
    expect(body).toContain('"type":"step"')
    expect(runEmbedTest).toHaveBeenCalledWith(expect.anything(), 'sonnet', expect.any(Function))
  })

  test('model=opus is forwarded', async () => {
    await (await POST(makeRequest({ model: 'opus' }))).text()
    expect(runEmbedTest).toHaveBeenCalledWith(expect.anything(), 'opus', expect.any(Function))
  })

  test('pipeline throw → error event in stream, not a crash', async () => {
    runEmbedTest.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('"type":"error"')
  })
})
