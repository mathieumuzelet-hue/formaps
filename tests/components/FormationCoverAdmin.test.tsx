import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { listQuery, invalidateList } = vi.hoisted(() => ({
  listQuery: vi.fn(),
  invalidateList: vi.fn(),
}))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      admin: {
        formations: {
          list: { invalidate: invalidateList },
        },
      },
    }),
    admin: {
      formations: {
        list: { useQuery: () => listQuery() },
      },
    },
  },
}))

import { FormationCoverAdmin } from '@/components/admin/FormationCoverAdmin'

const FORMATION = {
  id: 'f1',
  slug: 'caisse',
  name: 'Caisse',
  coverImageUrl: null as string | null,
}

function mockList(coverImageUrl: string | null) {
  listQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: [{ ...FORMATION, coverImageUrl }],
  })
}

describe('FormationCoverAdmin', () => {
  beforeEach(() => {
    listQuery.mockReset()
    invalidateList.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('affiche la preview quand la formation a une couverture', () => {
    mockList('/api/formations/f1/cover')
    render(<FormationCoverAdmin formationId="f1" />)
    const img = screen.getByRole('img', { name: 'Couverture' })
    expect(img.getAttribute('src')).toContain('/api/formations/f1/cover')
  })

  test("pas de preview sans couverture", () => {
    mockList(null)
    render(<FormationCoverAdmin formationId="f1" />)
    expect(screen.queryByRole('img', { name: 'Couverture' })).not.toBeInTheDocument()
  })

  test('upload réussi → POST sur la bonne URL puis invalidate', async () => {
    mockList(null)
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 201 }))
    const user = userEvent.setup()
    render(<FormationCoverAdmin formationId="f1" />)

    const input = screen.getByLabelText('Visuel de couverture')
    await user.upload(input, new File(['x'], 'cover.png', { type: 'image/png' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/admin/formations/f1/cover',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(invalidateList).toHaveBeenCalled()
    })
  })

  test('413 → message « Image trop lourde »', async () => {
    mockList(null)
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 413 }))
    const user = userEvent.setup()
    render(<FormationCoverAdmin formationId="f1" />)

    await user.upload(
      screen.getByLabelText('Visuel de couverture'),
      new File(['x'], 'big.png', { type: 'image/png' }),
    )

    expect(await screen.findByText('Image trop lourde (max 5 Mo)')).toBeInTheDocument()
    expect(invalidateList).not.toHaveBeenCalled()
  })

  test('415 → message « Format d’image non supporté »', async () => {
    mockList(null)
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 415 }))
    const user = userEvent.setup()
    render(<FormationCoverAdmin formationId="f1" />)

    await user.upload(
      screen.getByLabelText('Visuel de couverture'),
      new File(['x'], 'cover.svg', { type: 'image/svg+xml' }),
    )

    expect(await screen.findByText("Format d'image non supporté")).toBeInTheDocument()
  })
})
