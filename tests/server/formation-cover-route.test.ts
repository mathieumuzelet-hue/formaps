// @vitest-environment node
// Node env (pas jsdom) : `Request.formData()` utilise le parser undici, qui
// rejette les File/FormData de jsdom — en node, globals et parser concordent.
import { beforeEach, expect, test, vi } from 'vitest'

// --- Mocks ---------------------------------------------------------------
const { auth, selectLimit, updateSet, fsMocks } = vi.hoisted(() => ({
  auth: vi.fn(),
  /** Resolves the `.limit(1)` of the existence check. */
  selectLimit: vi.fn(),
  /** Captures the `.set(values)` of the update and resolves `.returning()`. */
  updateSet: vi.fn(),
  fsMocks: {
    mkdir: vi.fn(),
    readdir: vi.fn(),
    rm: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
}))

vi.mock('@/server/auth', () => ({ auth: () => auth() }))

vi.mock('@/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => selectLimit() }) }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({ returning: () => updateSet(values) }),
      }),
    }),
  },
}))
vi.mock('@/server/db/schema', () => ({ formations: {} }))
// The route only imports `eq`; the mocked schema has no real columns.
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }))

vi.mock('node:fs/promises', () => ({ default: fsMocks }))

import { POST } from '@/app/api/admin/formations/[id]/cover/route'
import { GET } from '@/app/api/formations/[id]/cover/route'

beforeEach(() => {
  vi.clearAllMocks()
})

const uploadParams = Promise.resolve({ id: 'f1' })
const serveParams = Promise.resolve({ id: 'f1' })

function makeUploadRequest(file?: File): Request {
  const form = new FormData()
  form.set('file', file ?? new File(['x'], 'cover.png', { type: 'image/png' }))
  return new Request('http://localhost/api/admin/formations/f1/cover', {
    method: 'POST',
    body: form,
  })
}

function mockAdmin() {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'admin' } })
}

// --- POST /api/admin/formations/[id]/cover --------------------------------

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

test('upload → 404 quand la formation est inconnue', async () => {
  mockAdmin()
  selectLimit.mockResolvedValue([])
  const res = await POST(makeUploadRequest(), { params: uploadParams })
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'formation_not_found' })
})

test('upload → 415 sur un type non-image', async () => {
  mockAdmin()
  selectLimit.mockResolvedValue([{ id: 'f1' }])
  const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
  const res = await POST(makeUploadRequest(file), { params: uploadParams })
  expect(res.status).toBe(415)
})

test('upload → 415 sur une image hors allowlist (svg)', async () => {
  mockAdmin()
  selectLimit.mockResolvedValue([{ id: 'f1' }])
  const file = new File(['<svg/>'], 'cover.svg', { type: 'image/svg+xml' })
  const res = await POST(makeUploadRequest(file), { params: uploadParams })
  expect(res.status).toBe(415)
  expect(await res.json()).toEqual({ error: 'unsupported_image_type' })
})

test('upload → 413 sur un fichier trop lourd (> 5 Mo)', async () => {
  mockAdmin()
  selectLimit.mockResolvedValue([{ id: 'f1' }])
  const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', {
    type: 'image/png',
  })
  const res = await POST(makeUploadRequest(big), { params: uploadParams })
  expect(res.status).toBe(413)
  expect(await res.json()).toEqual({ error: 'file_too_large' })
})

test('upload → 201, purge l’ancienne couverture, écrit le fichier et set coverImageUrl (sans updatedAt)', async () => {
  mockAdmin()
  selectLimit.mockResolvedValue([{ id: 'f1' }])
  fsMocks.mkdir.mockResolvedValue(undefined)
  fsMocks.readdir.mockResolvedValue(['f1.jpg', 'other.png'])
  fsMocks.rm.mockResolvedValue(undefined)
  fsMocks.writeFile.mockResolvedValue(undefined)
  updateSet.mockImplementation(async (values: Record<string, unknown>) => [
    { id: 'f1', ...values },
  ])

  const res = await POST(makeUploadRequest(), { params: uploadParams })
  expect(res.status).toBe(201)
  expect(await res.json()).toMatchObject({
    id: 'f1',
    coverImageUrl: '/api/formations/f1/cover',
  })

  // Purge: only the previous cover of THIS formation is removed.
  expect(fsMocks.rm).toHaveBeenCalledTimes(1)
  expect(String(fsMocks.rm.mock.calls[0][0])).toContain('f1.jpg')
  expect(String(fsMocks.writeFile.mock.calls[0][0])).toContain('f1.png')

  // formations has no updatedAt column — the update must not set one.
  expect(updateSet).toHaveBeenCalledWith({
    coverImageUrl: '/api/formations/f1/cover',
  })
})

// --- GET /api/formations/[id]/cover ----------------------------------------

test('serve → 401 pour un non authentifié', async () => {
  auth.mockResolvedValue(null)
  const res = await GET(new Request('http://localhost/api/formations/f1/cover'), {
    params: serveParams,
  })
  expect(res.status).toBe(401)
})

test('serve → 404 quand aucun fichier n’existe', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee' } })
  fsMocks.readdir.mockResolvedValue(['autre.png'])
  const res = await GET(new Request('http://localhost/api/formations/f1/cover'), {
    params: serveParams,
  })
  expect(res.status).toBe(404)
})

test('serve → 200 avec Content-Type et Cache-Control', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee' } })
  fsMocks.readdir.mockResolvedValue(['f1.webp'])
  fsMocks.readFile.mockResolvedValue(Buffer.from('img-bytes'))
  const res = await GET(new Request('http://localhost/api/formations/f1/cover'), {
    params: serveParams,
  })
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toBe('image/webp')
  expect(res.headers.get('Cache-Control')).toBe('private, max-age=60')
})
