import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const listQuery = vi.hoisted(() => vi.fn())
const deleteMutate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    admin: {
      faqBuilder: {
        list: { useQuery: listQuery },
        delete: { useMutation: () => ({ mutate: deleteMutate, isPending: false }) },
      },
    },
    useUtils: () => ({ admin: { faqBuilder: { list: { invalidate: vi.fn() } } } }),
  },
}))

import { FaqBuilderAdmin } from '@/components/admin/FaqBuilderAdmin'

beforeEach(() => {
  vi.clearAllMocks()
  listQuery.mockReturnValue({
    data: [
      {
        id: 'd1',
        sourceFilename: 'guide.pdf',
        itemCount: 12,
        updatedAt: new Date('2026-06-10T10:00:00Z'),
      },
    ],
    isLoading: false,
    isError: false,
  })
})

test('liste les brouillons avec nom, compteur et lien éditeur', () => {
  render(<FaqBuilderAdmin />)
  expect(screen.getByText('guide.pdf')).toBeInTheDocument()
  expect(screen.getByText(/12 paires/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /ouvrir/i })).toHaveAttribute(
    'href',
    '/admin/faq-builder/d1',
  )
})

test('upload réussi → redirige vers l’éditeur du brouillon créé', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ id: 'new-draft', count: 9 }),
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<FaqBuilderAdmin />)
  const file = new File(['%PDF-fake'], 'doc.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getByLabelText(/document source/i), file)
  await userEvent.click(screen.getByRole('button', { name: /générer la faq/i }))
  await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/admin/faq-builder/new-draft'))
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/admin/faq-builder',
    expect.objectContaining({ method: 'POST' }),
  )
  vi.unstubAllGlobals()
})

test('erreur serveur → bannière en français', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'empty_text' }),
    }),
  )
  render(<FaqBuilderAdmin />)
  const file = new File(['%PDF-fake'], 'doc.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getByLabelText(/document source/i), file)
  await userEvent.click(screen.getByRole('button', { name: /générer la faq/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/scanné/i)
  vi.unstubAllGlobals()
})
