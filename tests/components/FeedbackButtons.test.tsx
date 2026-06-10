import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const { feedbackMutate } = vi.hoisted(() => ({ feedbackMutate: vi.fn() }))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    brain: {
      feedback: {
        useMutation: () => ({ mutate: feedbackMutate, isPending: false }),
      },
    },
  },
}))

import { FeedbackButtons } from '@/components/brain/FeedbackButtons'

beforeEach(() => {
  feedbackMutate.mockClear()
})

test('clic 👍 → mutation like ; clic 👎 ensuite → mutation dislike (écrase)', () => {
  render(<FeedbackButtons messageId="msg-7" />)

  fireEvent.click(screen.getByRole('button', { name: /réponse utile/i }))
  expect(feedbackMutate).toHaveBeenCalledWith(
    { messageId: 'msg-7', feedback: 'like' },
    expect.objectContaining({ onError: expect.any(Function) }),
  )

  fireEvent.click(screen.getByRole('button', { name: /réponse inutile/i }))
  expect(feedbackMutate).toHaveBeenCalledWith(
    { messageId: 'msg-7', feedback: 'dislike' },
    expect.objectContaining({ onError: expect.any(Function) }),
  )
})

test('le bouton sélectionné est marqué aria-pressed', () => {
  render(<FeedbackButtons messageId="msg-7" />)
  const like = screen.getByRole('button', { name: /réponse utile/i })
  expect(like).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(like)
  expect(like).toHaveAttribute('aria-pressed', 'true')
})

test("rollback de l'état optimiste si la mutation échoue", () => {
  // mutate appelle options.onError → l'UI doit revenir à l'état précédent.
  feedbackMutate.mockImplementation(
    (_input: unknown, opts?: { onError?: (e: Error) => void }) =>
      opts?.onError?.(new Error('boom')),
  )
  render(<FeedbackButtons messageId="m1" />)
  const like = screen.getByRole('button', { name: /réponse utile/i })
  fireEvent.click(like)
  expect(like).toHaveAttribute('aria-pressed', 'false')
})
