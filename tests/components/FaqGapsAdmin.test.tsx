import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const { listQuery } = vi.hoisted(() => ({ listQuery: vi.fn() }))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    admin: { faqGaps: { list: { useQuery: () => listQuery() } } },
  },
}))

import { FaqGapsAdmin } from '@/components/admin/FaqGapsAdmin'

test('liste les groupes avec leurs agrégats', () => {
  listQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: [
      {
        question: 'Caisse Mercalys ?',
        count: 3,
        lastAskedAt: new Date('2026-06-03T10:00:00Z'),
        scoreMax: 0.4,
        retrievalCount: 2,
        dislikes: 1,
      },
    ],
  })

  render(<FaqGapsAdmin />)

  expect(screen.getByText('Caisse Mercalys ?')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('0.40')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /exporter/i })).toBeInTheDocument()
})

test('état vide explicite', () => {
  listQuery.mockReturnValue({ isLoading: false, isError: false, data: [] })
  render(<FaqGapsAdmin />)
  expect(screen.getByText(/aucun trou détecté/i)).toBeInTheDocument()
})
