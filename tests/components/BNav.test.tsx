import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

import { BNav } from '@/components/nav/BNav'

test('affiche le lien Admin pour un administrateur', () => {
  render(<BNav firstName="Camille" role="admin" />)
  const admin = screen.getByText('Admin').closest('a')
  expect(admin).toBeInTheDocument()
  expect(admin).toHaveAttribute('href', '/admin/magasins')
})

test("n'affiche pas le lien Admin pour un employé", () => {
  render(<BNav firstName="Camille" role="employee" />)
  expect(screen.queryByText('Admin')).not.toBeInTheDocument()
})
