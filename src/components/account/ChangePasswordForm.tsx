'use client'

import { signOut } from 'next-auth/react'
import { useState } from 'react'

import { trpc } from '@/lib/trpc/client'

const INPUT =
  'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px] focus:border-ink focus:outline-none'
const LABEL = 'mb-1 block text-[12px] font-medium text-sub'

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)

  const change = trpc.account.changePassword.useMutation({
    onSuccess: () => {
      // La mutation a bumpé passwordChangedAt : la session courante est morte.
      // Déconnexion propre + message sur la page de connexion.
      void signOut({ callbackUrl: '/connexion?changed=1' })
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      setClientError('Le nouveau mot de passe doit faire au moins 8 caractères.')
      return
    }
    if (newPassword !== confirm) {
      setClientError('Les deux nouveaux mots de passe ne correspondent pas.')
      return
    }
    setClientError(null)
    change.mutate({ currentPassword, newPassword })
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 max-w-[420px] rounded-[14px] border border-line bg-card p-5"
    >
      <div className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="current-password">
            Mot de passe actuel
          </label>
          <input
            id="current-password"
            className={INPUT}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="new-password">
            Nouveau mot de passe (min. 8 caractères)
          </label>
          <input
            id="new-password"
            className={INPUT}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="confirm-password">
            Confirmer le nouveau mot de passe
          </label>
          <input
            id="confirm-password"
            className={INPUT}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>

      {clientError && <p className="mt-3 text-[13px] text-red">{clientError}</p>}
      {change.isError && (
        <p className="mt-3 text-[13px] text-red">{change.error.message}</p>
      )}

      <button
        type="submit"
        disabled={
          change.isPending ||
          currentPassword === '' ||
          newPassword === '' ||
          confirm === ''
        }
        className="mt-4 rounded-lg bg-red px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-50"
      >
        {change.isPending ? 'Enregistrement…' : 'Changer mon mot de passe'}
      </button>
    </form>
  )
}
