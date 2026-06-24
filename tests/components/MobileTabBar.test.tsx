import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

import { MobileTabBar } from '@/components/nav/MobileTabBar'

test('affiche les 5 onglets', () => {
  render(<MobileTabBar />)
  expect(screen.getByText('Accueil')).toBeInTheDocument()
  expect(screen.getByText('Former')).toBeInTheDocument()
  expect(screen.getByText('BRAIN')).toBeInTheDocument()
  expect(screen.getByText('Actus')).toBeInTheDocument()
  expect(screen.getByText('Profil')).toBeInTheDocument()
})

test('expose un onglet Actualités vers /actualites', () => {
  render(<MobileTabBar />)
  const link = screen.getByRole('link', { name: /actus/i })
  expect(link).toHaveAttribute('href', '/actualites')
})

test("marque l'onglet actif (Accueil) avec le style actif", () => {
  render(<MobileTabBar />)
  const accueil = screen.getByText('Accueil').closest('a')
  expect(accueil).toHaveAttribute('aria-current', 'page')
  expect(accueil?.className).toContain('text-red')

  const former = screen.getByText('Former').closest('a')
  expect(former).not.toHaveAttribute('aria-current')
  expect(former?.className).toContain('text-faint')
})
