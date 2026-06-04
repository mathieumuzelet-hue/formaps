import { beforeEach, expect, test, vi } from 'vitest'

// --- Mocks ---------------------------------------------------------------
const auth = vi.fn()
vi.mock('@/server/auth', () => ({ auth: () => auth() }))

// Both guards return before any db/fs access, so a bare object suffices.
vi.mock('@/server/db', () => ({ db: {} }))
vi.mock('@/server/db/schema', () => ({ news: {} }))

import { POST } from '@/app/api/admin/news/[id]/cover/route'
import { GET } from '@/app/api/news/[id]/cover/route'

beforeEach(() => {
  vi.clearAllMocks()
})

const uploadParams = Promise.resolve({ id: 'n1' })
const serveParams = Promise.resolve({ id: 'n1' })

function makeUploadRequest(): Request {
  const form = new FormData()
  form.set('file', new File(['x'], 'cover.png', { type: 'image/png' }))
  return new Request('http://localhost/api/admin/news/n1/cover', {
    method: 'POST',
    body: form,
  })
}

test('upload → 403 pour un non-admin (employee)', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee' } })
  const res = await POST(makeUploadRequest(), { params: uploadParams })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'forbidden' })
})

test('upload → 403 pour un non authentifié', async () => {
  auth.mockResolvedValue(null)
  const res = await POST(makeUploadRequest(), { params: uploadParams })
  expect(res.status).toBe(403)
})

test('serve → 401 pour un non authentifié', async () => {
  auth.mockResolvedValue(null)
  const res = await GET(new Request('http://localhost/api/news/n1/cover'), { params: serveParams })
  expect(res.status).toBe(401)
})
