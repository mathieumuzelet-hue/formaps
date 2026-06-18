// @vitest-environment node
// Node env (precedent: embed-test-route.test.ts) : jsdom's FormData/File are
// not compatible with undici's Request.formData() parser, so any test that
// reaches server-side multipart parsing must run under the node environment.
import { beforeEach, expect, test, vi } from 'vitest'

// --- Mocks ---------------------------------------------------------------
const { auth, dbSelectLimit } = vi.hoisted(() => ({
  auth: vi.fn(),
  dbSelectLimit: vi.fn(),
}))
vi.mock('@/server/auth', () => ({ auth: () => auth() }))

// The db singleton needs DATABASE_URL + the postgres driver; mock it. The 403
// guards return before any db access; the formation-lookup chain is stubbed so
// the magic-bytes validation can be exercised under an admin session.
vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: dbSelectLimit })),
      })),
    })),
  },
}))
vi.mock('@/server/db/schema', () => ({
  formationDocuments: {},
  formations: {},
}))

import { POST } from '@/app/api/admin/formations/[id]/documents/route'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: the target formation exists (used by the validation tests).
  dbSelectLimit.mockResolvedValue([{ id: 'f1' }])
})

function makeRequest(file?: File): Request {
  const form = new FormData()
  form.set('file', file ?? new File(['%PDF-1.4 x'], 'doc.pdf', { type: 'application/pdf' }))
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

test('MIME application/pdf mais contenu non-PDF → 415', async () => {
  auth.mockResolvedValue({ user: { id: 'a1', role: 'admin' } })
  const file = new File(['not pdf'], 'd.pdf', { type: 'application/pdf' })
  const res = await POST(makeRequest(file), { params })
  expect(res.status).toBe(415)
  expect(await res.json()).toEqual({ error: 'invalid_type' })
})
