import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

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

afterEach(() => {
  vi.unstubAllGlobals()
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
})

test('Supprimer demande confirmation : annulé → pas de mutation, confirmé → mutation', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<FaqBuilderAdmin />)
  await userEvent.click(screen.getByRole('button', { name: /supprimer guide\.pdf/i }))
  expect(deleteMutate).not.toHaveBeenCalled()
  confirmSpy.mockReturnValue(true)
  await userEvent.click(screen.getByRole('button', { name: /supprimer guide\.pdf/i }))
  expect(deleteMutate).toHaveBeenCalledWith({ id: 'd1' })
  confirmSpy.mockRestore()
})

test('fichier > 25 Mo → bannière sans appel réseau', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  render(<FaqBuilderAdmin />)
  const big = new File(['%PDF-fake'], 'gros.pdf', { type: 'application/pdf' })
  Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 })
  await userEvent.upload(screen.getByLabelText(/document source/i), big)
  await userEvent.click(screen.getByRole('button', { name: /générer la faq/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/25 Mo/)
  expect(fetchMock).not.toHaveBeenCalled()
})
