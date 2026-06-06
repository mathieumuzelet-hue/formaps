import { render, screen } from '@testing-library/react'
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
})
