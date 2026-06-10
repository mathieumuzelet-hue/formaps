import { fireEvent, render } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { RefreshOnFocus } from '@/components/formation/RefreshOnFocus'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

beforeEach(() => {
  refresh.mockClear()
})

test('ne rend rien', () => {
  const { container } = render(<RefreshOnFocus />)
  expect(container).toBeEmptyDOMElement()
})

test('rafraîchit la route au focus de la fenêtre (retour de l’onglet PDF)', () => {
  render(<RefreshOnFocus />)
  expect(refresh).not.toHaveBeenCalled()
  fireEvent.focus(window)
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('détache le listener au démontage', () => {
  const { unmount } = render(<RefreshOnFocus />)
  unmount()
  fireEvent.focus(window)
  expect(refresh).not.toHaveBeenCalled()
})
