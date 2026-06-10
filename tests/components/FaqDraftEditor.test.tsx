import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const getQuery = vi.hoisted(() => vi.fn())
const updateMutate = vi.hoisted(() => vi.fn())
const generateMoreMutate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    admin: {
      faqBuilder: {
        get: { useQuery: getQuery },
        updateItems: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
        generateMore: {
          useMutation: () => ({ mutate: generateMoreMutate, isPending: false }),
        },
      },
    },
    useUtils: () => ({ admin: { faqBuilder: { get: { invalidate: vi.fn() } } } }),
  },
}))

const downloadCsv = vi.hoisted(() => vi.fn())
vi.mock('@/lib/admin/download-csv', () => ({ downloadCsv }))

import { FaqDraftEditor } from '@/components/admin/FaqDraftEditor'

const DRAFT = {
  id: 'd1',
  sourceFilename: 'guide.pdf',
  updatedAt: new Date('2026-06-10T10:00:00Z'),
  items: [
    { id: 'i1', question: 'Q1 ?', answer: 'R1.', origin: 'generated' as const },
    { id: 'i2', question: 'Q2 ?', answer: 'R2.', origin: 'manual' as const },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  getQuery.mockReturnValue({ data: DRAFT, isLoading: false, isError: false })
})

test('affiche les paires avec badges origine et compteur', () => {
  render(<FaqDraftEditor draftId="d1" />)
  expect(screen.getByDisplayValue('Q1 ?')).toBeInTheDocument()
  expect(screen.getByDisplayValue('R2.')).toBeInTheDocument()
  expect(screen.getByText(/2 paires/)).toBeInTheDocument()
  expect(screen.getByText('générée')).toBeInTheDocument()
  expect(screen.getByText('manuelle')).toBeInTheDocument()
})

test('éditer une question rend le brouillon dirty : Enregistrer activé, Exporter et Générer plus désactivés', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  expect(screen.getByRole('button', { name: /enregistrer/i })).toBeDisabled()
  await userEvent.type(screen.getByDisplayValue('Q1 ?'), ' bis')
  expect(screen.getByRole('button', { name: /enregistrer/i })).toBeEnabled()
  expect(screen.getByRole('button', { name: /exporter csv/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /générer plus/i })).toBeDisabled()
})

test('Enregistrer envoie la liste éditée', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.type(screen.getByDisplayValue('Q1 ?'), ' bis')
  await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }))
  expect(updateMutate).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'd1',
      items: expect.arrayContaining([expect.objectContaining({ question: 'Q1 ? bis' })]),
    }),
    expect.anything(),
  )
})

test('Ajouter une paire crée un item manuel vide, Enregistrer bloqué tant que vide', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getByRole('button', { name: /ajouter une paire/i }))
  expect(screen.getByText(/3 paires/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /enregistrer/i })).toBeDisabled()
  expect(screen.getByText(/champs vides/i)).toBeInTheDocument()
})

test('Supprimer retire la paire', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getAllByRole('button', { name: /supprimer la paire/i })[0])
  expect(screen.queryByDisplayValue('Q1 ?')).not.toBeInTheDocument()
})

test('Descendre permute les paires', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getByRole('button', { name: /descendre la paire 1/i }))
  const questions = screen.getAllByLabelText(/^question/i) as HTMLTextAreaElement[]
  expect(questions[0].value).toBe('Q2 ?')
  expect(questions[1].value).toBe('Q1 ?')
})

test('Exporter CSV (état propre) télécharge faq-<slug>-<date>.csv', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getByRole('button', { name: /exporter csv/i }))
  expect(downloadCsv).toHaveBeenCalledWith(
    expect.stringMatching(/^faq-guide-pdf-\d{4}-\d{2}-\d{2}\.csv$/),
    expect.stringContaining('question,answer'),
  )
})

test('Générer plus (état propre) appelle la mutation', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getByRole('button', { name: /générer plus/i }))
  expect(generateMoreMutate).toHaveBeenCalledWith({ draftId: 'd1' }, expect.anything())
})
