import { beforeEach, expect, test, vi } from 'vitest'

const auth = vi.fn()
const selectLimit = vi.fn()
vi.mock('@/server/auth', () => ({ auth: () => auth() }))
vi.mock('@/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => selectLimit(...args),
        }),
      }),
    }),
  },
}))
vi.mock('@/server/db/schema', () => ({ formationDocuments: { id: 'id', title: 'title' } }))
vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn().mockResolvedValue({}),
    readFile: vi.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  },
}))

import { GET } from '@/app/api/documents/[docId]/download/route'

beforeEach(() => {
  auth.mockReset()
  selectLimit.mockReset()
})

const params = Promise.resolve({ docId: 'd1' })

function makeRequest(search = ''): Request {
  return new Request(`http://localhost/api/documents/d1/download${search}`)
}

test('non authentifié → 401', async () => {
  auth.mockResolvedValue(null)
  const res = await GET(makeRequest(), { params })
  expect(res.status).toBe(401)
})

test('par défaut le PDF est servi inline (visionneuse navigateur)', async () => {
  auth.mockResolvedValue({ user: { id: 'u1' } })
  selectLimit.mockResolvedValue([{ title: 'Guide Mercalys' }])
  const res = await GET(makeRequest(), { params })
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Disposition')).toBe('inline; filename="Guide_Mercalys.pdf"')
})

test('?download=1 force le téléchargement (attachment)', async () => {
  auth.mockResolvedValue({ user: { id: 'u1' } })
  selectLimit.mockResolvedValue([{ title: 'Guide Mercalys' }])
  const res = await GET(makeRequest('?download=1'), { params })
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Disposition')).toBe(
    'attachment; filename="Guide_Mercalys.pdf"',
  )
})
