import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const getQuery = vi.hoisted(() => vi.fn())
const updateMutate = vi.hoisted(() => vi.fn())
const generateMoreMutate = vi.hoisted(() => vi.fn())
const updatePending = vi.hoisted(() => ({ value: false }))
const generateMorePending = vi.hoisted(() => ({ value: false }))
const difyStatusQuery = vi.hoisted(() => vi.fn())
const difyStatusRefetch = vi.hoisted(() => vi.fn())
const pushFaqMutate = vi.hoisted(() => vi.fn())
const pushFaqPending = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    admin: {
      faqBuilder: {
        get: { useQuery: getQuery },
        updateItems: {
          useMutation: () => ({ mutate: updateMutate, isPending: updatePending.value }),
        },
        generateMore: {
          useMutation: () => ({
            mutate: generateMoreMutate,
            isPending: generateMorePending.value,
          }),
        },
      },
      difySync: {
        status: { useQuery: difyStatusQuery },
        pushFaq: {
          useMutation: () => ({ mutate: pushFaqMutate, isPending: pushFaqPending.value }),
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
  updatePending.value = false
  generateMorePending.value = false
  getQuery.mockReturnValue({ data: DRAFT, isLoading: false, isError: false })
  pushFaqPending.value = false
  difyStatusQuery.mockReturnValue({ data: [], refetch: difyStatusRefetch })
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

test('pendant Générer plus (pending) : textareas et actions par paire gelées', () => {
  generateMorePending.value = true
  render(<FaqDraftEditor draftId="d1" />)
  expect(screen.getByDisplayValue('Q1 ?')).toBeDisabled()
  expect(screen.getByDisplayValue('R1.')).toBeDisabled()
  expect(screen.getAllByRole('button', { name: /supprimer la paire/i })[0]).toBeDisabled()
  expect(screen.getByRole('button', { name: /descendre la paire 1/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /ajouter une paire/i })).toBeDisabled()
})

test('erreur generateMore no_new_pairs → bannière status (pas alert) avec message FAQ couverte', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getByRole('button', { name: /générer plus/i }))
  const options = generateMoreMutate.mock.calls[0][1] as {
    onError: (e: { message: string }) => void
  }
  act(() => options.onError({ message: 'no_new_pairs' }))
  expect(await screen.findByRole('status')).toHaveTextContent(/couvre probablement déjà/i)
})

test('succès generateMore remplace les items et annonce le nombre ajouté', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getByRole('button', { name: /générer plus/i }))
  const options = generateMoreMutate.mock.calls[0][1] as {
    onSuccess: (r: { added: number; items: unknown[] }) => void
  }
  act(() =>
    options.onSuccess({
      added: 1,
      items: [
        ...DRAFT.items,
        { id: 'i3', question: 'Q3 ?', answer: 'R3.', origin: 'generated' },
      ],
    }),
  )
  expect(await screen.findByDisplayValue('Q3 ?')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(/1 paire ajoutée/)
})
