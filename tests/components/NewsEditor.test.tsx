import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { byIdQuery, updateMutation, setStatusMutation } = vi.hoisted(() => ({
  byIdQuery: vi.fn(),
  updateMutation: vi.fn(),
  setStatusMutation: vi.fn(),
}))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      admin: {
        news: {
          byId: { invalidate: vi.fn() },
          list: { invalidate: vi.fn() },
        },
      },
    }),
    admin: {
      news: {
        byId: { useQuery: () => byIdQuery() },
        update: { useMutation: () => updateMutation() },
        setStatus: { useMutation: () => setStatusMutation() },
      },
    },
  },
}))

// Tiptap est testé séparément (TiptapEditor.test.tsx) — stub léger ici.
vi.mock('@/components/admin/TiptapEditor', () => ({
  TiptapEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Contenu" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { NewsEditor } from '@/components/admin/NewsEditor'

const ARTICLE = {
  id: 'a1',
  title: 'Titre existant',
  slug: 'titre-existant',
  excerpt: '',
  authorName: '',
  contentHtml: '<p>corps</p>',
  status: 'draft',
  coverImageUrl: null,
  updatedAt: new Date('2026-06-01T10:00:00Z'),
}

function mockHappyPath(status: 'draft' | 'published') {
  byIdQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { ...ARTICLE, status },
  })
  updateMutation.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
  setStatusMutation.mockReturnValue({ mutate: vi.fn(), isPending: false })
}

describe('NewsEditor', () => {
  beforeEach(() => {
    byIdQuery.mockReset()
    updateMutation.mockReset()
    setStatusMutation.mockReset()
  })

  test("masque « Voir » sur un brouillon (news.bySlug rejette les drafts)", () => {
    mockHappyPath('draft')
    render(<NewsEditor id="a1" />)
    expect(screen.queryByRole('link', { name: 'Voir' })).not.toBeInTheDocument()
  })

  test('affiche « Voir » quand l’article est publié', () => {
    mockHappyPath('published')
    render(<NewsEditor id="a1" />)
    expect(screen.getByRole('link', { name: 'Voir' })).toHaveAttribute(
      'href',
      '/actualites/titre-existant',
    )
  })

  test('désactive « Publier » tant que des modifications ne sont pas enregistrées', async () => {
    mockHappyPath('draft')
    const user = userEvent.setup()
    render(<NewsEditor id="a1" />)

    const publish = screen.getByRole('button', { name: 'Publier' })
    expect(publish).toBeEnabled()

    await user.type(screen.getByDisplayValue('Titre existant'), ' modifié')

    expect(screen.getByRole('button', { name: 'Publier' })).toBeDisabled()
    expect(screen.getByText(/modifications non enregistrées/i)).toBeInTheDocument()
  })

  test('arme beforeunload quand le formulaire est dirty', async () => {
    mockHappyPath('draft')
    const addSpy = vi.spyOn(window, 'addEventListener')
    const user = userEvent.setup()
    render(<NewsEditor id="a1" />)

    await user.type(screen.getByDisplayValue('Titre existant'), '!')

    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    addSpy.mockRestore()
  })
})
