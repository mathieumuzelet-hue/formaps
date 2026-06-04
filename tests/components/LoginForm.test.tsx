import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { LoginForm } from '@/components/auth/LoginForm'

const signIn = vi.fn()
const push = vi.fn()
const refresh = vi.fn()

vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signIn(...args),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

describe('LoginForm', () => {
  beforeEach(() => {
    signIn.mockReset()
    push.mockReset()
    refresh.mockReset()
  })

  test('rend les champs et le bouton', () => {
    render(<LoginForm />)
    expect(screen.getByText('Identifiant')).toBeInTheDocument()
    expect(screen.getByText('Mot de passe')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Embarquer/i }),
    ).toBeInTheDocument()
  })

  test('affiche une erreur quand signIn renvoie une erreur', async () => {
    signIn.mockResolvedValue({ error: 'CredentialsSignin' })
    const user = userEvent.setup()
    render(<LoginForm />)

    await user.click(screen.getByRole('button', { name: /Embarquer/i }))

    expect(
      await screen.findByText('Identifiant ou mot de passe invalide'),
    ).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  test('redirige vers la home en cas de succès', async () => {
    signIn.mockResolvedValue({ error: null, ok: true })
    const user = userEvent.setup()
    render(<LoginForm />)

    await user.type(screen.getByPlaceholderText('prenom.nom@aps.fr'), 'camille@aps.fr')
    await user.click(screen.getByRole('button', { name: /Embarquer/i }))

    expect(signIn).toHaveBeenCalledWith('credentials', {
      email: 'camille@aps.fr',
      password: '',
      redirect: false,
    })
    expect(push).toHaveBeenCalledWith('/')
  })
})
