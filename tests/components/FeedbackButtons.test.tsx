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
  expect(feedbackMutate).toHaveBeenCalledWith({ messageId: 'msg-7', feedback: 'like' })

  fireEvent.click(screen.getByRole('button', { name: /réponse inutile/i }))
  expect(feedbackMutate).toHaveBeenCalledWith({ messageId: 'msg-7', feedback: 'dislike' })
})

test('le bouton sélectionné est marqué aria-pressed', () => {
  render(<FeedbackButtons messageId="msg-7" />)
  const like = screen.getByRole('button', { name: /réponse utile/i })
  expect(like).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(like)
  expect(like).toHaveAttribute('aria-pressed', 'true')
})
