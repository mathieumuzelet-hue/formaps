import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

// LoginForm utilise next-auth/react + navigation — on le neutralise, la page
// est testée pour sa bannière, pas pour le formulaire.
vi.mock('@/components/auth/LoginForm', () => ({ LoginForm: () => <div /> }))

import ConnexionPage from '@/app/(auth)/connexion/page'

test('?changed=1 → bannière « Mot de passe modifié, reconnectez-vous. »', async () => {
  render(await ConnexionPage({ searchParams: Promise.resolve({ changed: '1' }) }))
  expect(screen.getByText(/mot de passe modifié, reconnectez-vous/i)).toBeInTheDocument()
})

test('sans param → pas de bannière', async () => {
  render(await ConnexionPage({ searchParams: Promise.resolve({}) }))
  expect(screen.queryByText(/reconnectez-vous/i)).not.toBeInTheDocument()
})
