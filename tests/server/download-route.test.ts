import { beforeEach, expect, test, vi } from 'vitest'

const auth = vi.fn()
vi.mock('@/server/auth', () => ({ auth: () => auth() }))
vi.mock('@/server/db', () => ({ db: {} }))
vi.mock('@/server/db/schema', () => ({ formationDocuments: {} }))

import { GET } from '@/app/api/documents/[docId]/download/route'

beforeEach(() => {
  vi.clearAllMocks()
})

const params = Promise.resolve({ docId: 'd1' })

function makeRequest(): Request {
  return new Request('http://localhost/api/documents/d1/download')
}

test('non authentifié → 401', async () => {
  auth.mockResolvedValue(null)
  const res = await GET(makeRequest(), { params })
  expect(res.status).toBe(401)
})
