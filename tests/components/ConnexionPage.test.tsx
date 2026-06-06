import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// LoginForm utilise next-auth/react + navigation — on le neutralise, la page
// est testée pour sa bannière et son bounce, pas pour le formulaire.
vi.mock('@/components/auth/LoginForm', () => ({ LoginForm: () => <div /> }))

const { auth, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((url: string) => {
    // Comportement réel de next/navigation : redirect() jette.
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('@/server/auth', () => ({ auth }))
vi.mock('next/navigation', () => ({ redirect }))

import ConnexionPage from '@/app/(auth)/connexion/page'

beforeEach(() => {
  vi.clearAllMocks()
  // Par défaut : pas de session (cas visiteur ou token périmé tué par le
  // callback Node) → la page doit rendre le formulaire.
  auth.mockResolvedValue(null)
})

test('session valide → bounce Node-side vers / (remplace le redirect-home du middleware)', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', firstName: 'Léa' } })

  await expect(ConnexionPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    'NEXT_REDIRECT:/',
  )
  expect(redirect).toHaveBeenCalledWith('/')
})

test('token périmé (session null côté Node) → le formulaire est rendu, pas de boucle', async () => {
  render(await ConnexionPage({ searchParams: Promise.resolve({}) }))
  expect(redirect).not.toHaveBeenCalled()
})

test('?changed=1 → bannière « Mot de passe modifié, reconnectez-vous. »', async () => {
  render(await ConnexionPage({ searchParams: Promise.resolve({ changed: '1' }) }))
  expect(screen.getByText(/mot de passe modifié, reconnectez-vous/i)).toBeInTheDocument()
})

test('sans param → pas de bannière', async () => {
  render(await ConnexionPage({ searchParams: Promise.resolve({}) }))
  expect(screen.queryByText(/reconnectez-vous/i)).not.toBeInTheDocument()
})
