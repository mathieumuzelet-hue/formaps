import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/embed-test/useEmbedTest', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/embed-test/useEmbedTest')>()
  return {
    ...actual,
    useEmbedTest: () => ({ state: actual.initialState, run: vi.fn(), reset: vi.fn() }),
  }
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
})
