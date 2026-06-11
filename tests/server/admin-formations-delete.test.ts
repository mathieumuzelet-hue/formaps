import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const rm = vi.fn().mockResolvedValue(undefined)
const readdir = vi.fn().mockResolvedValue([])
vi.mock('node:fs/promises', () => ({
  default: { rm: (...a: unknown[]) => rm(...a), readdir: (...a: unknown[]) => readdir(...a) },
}))

const FORMATION_ID = '22222222-2222-4222-8222-222222222222'
const DOC_A = '33333333-3333-4333-8333-333333333333'
const DOC_B = '44444444-4444-4444-8444-444444444444'

// select chain: select().from().where() — awaitable, yields the doc rows.
const selectWhere = vi.fn()
const selectFrom = vi.fn(() => ({ where: selectWhere }))
// delete chain: delete().where().returning() — yields the deleted formation row or [].
const deleteReturning = vi.fn()
const deleteWhere = vi.fn(() => ({ returning: deleteReturning }))
const dbMock = {
  select: vi.fn(() => ({ from: selectFrom })),
  delete: vi.fn(() => ({ where: deleteWhere })),
} as never

import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)

const caller = createCaller({
  session: {
    user: { id: 'admin1', role: 'admin', storeId: null, firstName: 'Admin', email: 'adm@b.fr' },
    expires: '',
  },
  db: dbMock,
} as never)

describe('admin.formations.delete — nettoyage disque', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rm.mockResolvedValue(undefined)
    readdir.mockResolvedValue([])
    selectWhere.mockResolvedValue([{ id: DOC_A }, { id: DOC_B }])
    deleteReturning.mockResolvedValue([{ id: FORMATION_ID }])
  })

  it('supprime le PDF de chaque document de la formation', async () => {
    await caller.formations.delete({ id: FORMATION_ID })
    const removed = rm.mock.calls.map((c) => String(c[0]).replace(/\\/g, '/'))
    expect(removed).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${DOC_A}.pdf`),
        expect.stringContaining(`${DOC_B}.pdf`),
      ]),
    )
  })

  it('supprime les fichiers de couverture <id>.* du dossier formations', async () => {
    readdir.mockResolvedValue([`${FORMATION_ID}.webp`, 'autre.webp'])
    await caller.formations.delete({ id: FORMATION_ID })
    const removed = rm.mock.calls.map((c) => String(c[0]).replace(/\\/g, '/'))
    expect(removed.some((p) => p.endsWith(`formations/${FORMATION_ID}.webp`))).toBe(true)
    expect(removed.some((p) => p.endsWith('formations/autre.webp'))).toBe(false)
  })

  it("un échec fs ne fait pas échouer la mutation (best-effort)", async () => {
    rm.mockRejectedValue(new Error('EACCES'))
    readdir.mockRejectedValue(new Error('ENOENT'))
    const result = await caller.formations.delete({ id: FORMATION_ID })
    expect(result).toEqual({ id: FORMATION_ID })
  })

  it('NOT_FOUND inchangé quand la formation est introuvable (aucun rm)', async () => {
    deleteReturning.mockResolvedValue([])
    await expect(caller.formations.delete({ id: FORMATION_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(rm).not.toHaveBeenCalled()
  })
})
