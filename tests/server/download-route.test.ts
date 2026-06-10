import { beforeEach, expect, test, vi } from 'vitest'

const auth = vi.fn()
const selectLimit = vi.fn()
const insertValues = vi.fn()
const insertConflict = vi.fn()
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
    insert: () => ({
      values: (...args: unknown[]) => {
        insertValues(...args)
        return { onConflictDoNothing: () => insertConflict() }
      },
    }),
  },
}))
vi.mock('@/server/db/schema', () => ({
  formationDocuments: { id: 'id', title: 'title' },
  userDocumentViews: {},
}))
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
  insertValues.mockReset()
  insertConflict.mockReset()
  insertConflict.mockResolvedValue(undefined)
})

const params = Promise.resolve({ docId: 'd1' })

function makeRequest(search = ''): Request {
  return new Request(`http://localhost/api/documents/d1/download${search}`)
}

test('non authentifié → 401', async () => {
  auth.mockResolvedValue(null)
  const res = await GET(makeRequest(), { params })
  expect(res.status).toBe(401)
  expect(insertValues).not.toHaveBeenCalled()
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

test('une consultation enregistre une vue (user, document)', async () => {
  auth.mockResolvedValue({ user: { id: 'u1' } })
  selectLimit.mockResolvedValue([{ title: 'Guide Mercalys' }])
  const res = await GET(makeRequest(), { params })
  expect(res.status).toBe(200)
  expect(insertValues).toHaveBeenCalledWith({ userId: 'u1', documentId: 'd1' })
})

test("document inconnu → 404, aucune vue n'est enregistrée", async () => {
  auth.mockResolvedValue({ user: { id: 'u1' } })
  selectLimit.mockResolvedValue([])
  const res = await GET(makeRequest(), { params })
  expect(res.status).toBe(404)
  expect(insertValues).not.toHaveBeenCalled()
})

test("l'échec de l'insert de vue ne bloque pas le téléchargement (fire-and-forget)", async () => {
  auth.mockResolvedValue({ user: { id: 'u1' } })
  selectLimit.mockResolvedValue([{ title: 'Guide Mercalys' }])
  insertConflict.mockRejectedValue(new Error('db down'))
  const res = await GET(makeRequest(), { params })
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toBe('application/pdf')
  // Laisse la promesse fire-and-forget se résoudre : aucune unhandled rejection.
  await new Promise((r) => setTimeout(r, 0))
})
