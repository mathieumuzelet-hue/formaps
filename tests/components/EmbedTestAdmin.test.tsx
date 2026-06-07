import { afterEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

let mockState: import('@/lib/embed-test/useEmbedTest').EmbedTestState | undefined
vi.mock('@/lib/embed-test/useEmbedTest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/embed-test/useEmbedTest')>()
  return {
    ...actual,
    // mockState is read at RENDER time (after module init) — never assign it
    // inside this hoisted factory (TDZ trap with `let`).
    useEmbedTest: () => ({
      state: mockState ?? actual.initialState,
      run: vi.fn(),
      reset: vi.fn(),
    }),
  }
})

afterEach(() => {
  mockState = undefined
})

import { EmbedTestAdmin } from '@/components/admin/EmbedTestAdmin'

describe('EmbedTestAdmin', () => {
  test('renders upload form with sonnet default and disabled launch button', () => {
    render(<EmbedTestAdmin />)
    expect(screen.getByText(/Labo d'embed/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Fichier PDF/i)).toBeInTheDocument()
    const select = screen.getByLabelText(/Modèle/i) as HTMLSelectElement
    expect(select.value).toBe('sonnet')
    expect(screen.getByRole('button', { name: /Lancer le test/i })).toBeDisabled()
    expect(screen.getByText(/API Claude d'Anthropic/i)).toBeInTheDocument()
  })

  test('oversized file disables launch button and shows hint', () => {
    render(<EmbedTestAdmin />)
    const file = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 + 1 })
    fireEvent.change(screen.getByLabelText(/Fichier PDF/i), {
      target: { files: [file] },
    })
    expect(screen.getByRole('button', { name: /Lancer le test/i })).toBeDisabled()
    expect(
      screen.getByText(/Fichier trop volumineux \(25 Mo max\)\./i),
    ).toBeInTheDocument()
  })

  test('renders the diagnostic card when a diagnostic is present', async () => {
    const { initialState } = await import('@/lib/embed-test/useEmbedTest')
    mockState = {
      ...initialState,
      status: 'running',
      diagnostic: {
        totalChars: 1000,
        paragraphBreaks: 0,
        lineBreaks: 12,
        avgParagraphTokens: 800,
        shortLineRatio: 0.2,
        verdict: 'flat',
        notes: ['Aucun saut de paragraphe (\\n\\n) détecté'],
      },
    }
    render(<EmbedTestAdmin />)
    expect(screen.getByText(/Structure du texte extrait/i)).toBeInTheDocument()
    expect(screen.getByText(/Plat/i)).toBeInTheDocument()
    expect(screen.getByText(/Aucun saut de paragraphe/i)).toBeInTheDocument()
  })
})
