import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { MarkDoneButton } from '@/components/formation/MarkDoneButton'

const { markDoneMutate, markUndoneMutate } = vi.hoisted(() => ({
  markDoneMutate: vi.fn(),
  markUndoneMutate: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    progress: {
      markDone: {
        useMutation: () => ({ mutate: markDoneMutate, isPending: false, isError: false }),
      },
      markUndone: {
        useMutation: () => ({ mutate: markUndoneMutate, isPending: false, isError: false }),
      },
    },
  },
}))

const FORMATION_ID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'

beforeEach(() => {
  markDoneMutate.mockClear()
  markUndoneMutate.mockClear()
})

test('percent < 100 : bouton "Marquer comme terminée" appelle markDone', () => {
  render(<MarkDoneButton formationId={FORMATION_ID} percent={40} />)
  const btn = screen.getByRole('button', { name: /marquer comme terminée/i })
  fireEvent.click(btn)
  expect(markDoneMutate).toHaveBeenCalledWith({ formationId: FORMATION_ID })
})

test('percent = 100 : badge terminé + lien d\'annulation appelle markUndone', () => {
  render(<MarkDoneButton formationId={FORMATION_ID} percent={100} />)
  expect(screen.getByText(/formation terminée/i)).toBeInTheDocument()
  const undo = screen.getByRole('button', { name: /marquer comme non terminée/i })
  fireEvent.click(undo)
  expect(markUndoneMutate).toHaveBeenCalledWith({ formationId: FORMATION_ID })
})

test('percent = 100 : le bouton "Marquer comme terminée" n\'est pas affiché', () => {
  render(<MarkDoneButton formationId={FORMATION_ID} percent={100} />)
  expect(
    screen.queryByRole('button', { name: /^marquer comme terminée$/i }),
  ).not.toBeInTheDocument()
})
