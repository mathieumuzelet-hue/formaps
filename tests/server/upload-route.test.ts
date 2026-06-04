import { beforeEach, expect, test, vi } from 'vitest'

// --- Mocks ---------------------------------------------------------------
const auth = vi.fn()
vi.mock('@/server/auth', () => ({ auth: () => auth() }))

// The db singleton needs DATABASE_URL + the postgres driver; mock it. The 403
// guard returns before any db access, so a bare object suffices here.
vi.mock('@/server/db', () => ({ db: {} }))
vi.mock('@/server/db/schema', () => ({
  formationDocuments: {},
  formations: {},
}))

import { POST } from '@/app/api/admin/formations/[id]/documents/route'

beforeEach(() => {
  vi.clearAllMocks()
})

function makeRequest(): Request {
  const form = new FormData()
  form.set('file', new File(['x'], 'doc.pdf', { type: 'application/pdf' }))
  return new Request('http://localhost/api/admin/formations/f1/documents', {
    method: 'POST',
    body: form,
  })
}

const params = Promise.resolve({ id: 'f1' })

test('non-admin (employee) → 403', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee' } })
  const res = await POST(makeRequest(), { params })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'forbidden' })
})

test('non authentifié → 403', async () => {
  auth.mockResolvedValue(null)
  const res = await POST(makeRequest(), { params })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'forbidden' })
})
