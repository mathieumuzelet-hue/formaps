import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ChangePasswordForm } from '@/components/account/ChangePasswordForm'

const { changeMutate, lastOptions } = vi.hoisted(() => ({
  changeMutate: vi.fn(),
  lastOptions: { onSuccess: undefined as undefined | (() => void) },
}))
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('next-auth/react', () => ({ signOut }))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    account: {
      changePassword: {
        useMutation: (options?: { onSuccess?: () => void }) => {
          lastOptions.onSuccess = options?.onSuccess
          return {
            mutate: changeMutate,
            isPending: false,
            isError: false,
            isSuccess: false,
          }
        },
      },
    },
  },
}))

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  changeMutate.mockClear()
  signOut.mockClear()
  lastOptions.onSuccess = undefined
})

test('soumet quand les deux nouveaux mdp correspondent', () => {
  render(<ChangePasswordForm />)
  fill(/mot de passe actuel/i, 'ancien123')
  fill(/^nouveau mot de passe/i, 'nouveau-mdp-1')
  fill(/confirmer/i, 'nouveau-mdp-1')
  fireEvent.click(screen.getByRole('button', { name: /changer mon mot de passe/i }))
  expect(changeMutate).toHaveBeenCalledWith({
    currentPassword: 'ancien123',
    newPassword: 'nouveau-mdp-1',
  })
})

test('onSuccess déconnecte vers /connexion?changed=1', () => {
  render(<ChangePasswordForm />)
  lastOptions.onSuccess?.()
  expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/connexion?changed=1' })
})

test('bloque et affiche une erreur si la confirmation diffère', () => {
  render(<ChangePasswordForm />)
  fill(/mot de passe actuel/i, 'ancien123')
  fill(/^nouveau mot de passe/i, 'nouveau-mdp-1')
  fill(/confirmer/i, 'autre-chose')
  fireEvent.click(screen.getByRole('button', { name: /changer mon mot de passe/i }))
  expect(changeMutate).not.toHaveBeenCalled()
  expect(screen.getByText(/ne correspondent pas/i)).toBeInTheDocument()
})

test('bloque si le nouveau mdp fait moins de 8 caractères', () => {
  render(<ChangePasswordForm />)
  fill(/mot de passe actuel/i, 'ancien123')
  fill(/^nouveau mot de passe/i, 'court')
  fill(/confirmer/i, 'court')
  fireEvent.click(screen.getByRole('button', { name: /changer mon mot de passe/i }))
  expect(changeMutate).not.toHaveBeenCalled()
  expect(screen.getByText(/au moins 8 caractères/i)).toBeInTheDocument()
})
