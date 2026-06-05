import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))

const sendFeedback = vi.fn()
vi.mock('@/server/dify/client', () => ({
  sendFeedback: (...args: unknown[]) => sendFeedback(...args),
}))

const updateWhere = vi.fn()
const updateSet = vi.fn(() => ({ where: updateWhere }))
const dbUpdate = vi.fn(() => ({ set: updateSet }))
const dbMock = { update: dbUpdate } as never

vi.mock('@/server/db', () => ({ db: {} }))

import { brainRouter } from '@/server/trpc/routers/brain'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(brainRouter)

function caller(userId = 'u1') {
  return createCaller({
    session: {
      user: { id: userId, role: 'employee', storeId: null, firstName: 'Léa', email: 'a@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  // returning() resolves with the updated row (ownership OK by default).
  updateWhere.mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'cq-1' }]) })
  sendFeedback.mockResolvedValue(undefined)
})

test('update le feedback et relaie à Dify', async () => {
  await caller().feedback({ messageId: 'msg-7', feedback: 'dislike' })

  expect(updateSet).toHaveBeenCalledWith({ feedback: 'dislike' })
  expect(sendFeedback).toHaveBeenCalledWith({ messageId: 'msg-7', rating: 'dislike', user: 'u1' })
})

test('message inconnu ou appartenant à un autre user → NOT_FOUND, pas de relais', async () => {
  updateWhere.mockReturnValue({ returning: vi.fn().mockResolvedValue([]) })

  await expect(caller().feedback({ messageId: 'other', feedback: 'like' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
  expect(sendFeedback).not.toHaveBeenCalled()
})

test('échec du relais Dify → la mutation réussit quand même', async () => {
  sendFeedback.mockRejectedValue(new Error('dify down'))

  const result = await caller().feedback({ messageId: 'msg-7', feedback: 'like' })
  expect(result).toEqual({ ok: true })
})
