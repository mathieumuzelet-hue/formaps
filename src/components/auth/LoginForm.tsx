'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

import { Icon } from '@/components/ui/Icon'
import { COLORS } from '@/lib/design/tokens'

function Field({
  label,
  type,
  placeholder,
  icon,
  value,
  onChange,
  autoComplete,
}: {
  label: string
  type: string
  placeholder: string
  icon: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
}) {
  return (
    <label className="block">
      <div className="mb-[7px] text-[12.5px] font-bold text-sub">{label}</div>
      <div className="flex items-center gap-[10px] rounded-[10px] border border-line bg-card px-[14px] py-[13px]">
        <Icon name={icon} size={18} color={COLORS.faint} />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
        />
      </div>
    </label>
  )
}

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(false)
    setSubmitting(true)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError(true)
        setSubmitting(false)
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      // Network failure before NextAuth could answer — same UX as bad creds.
      setError(true)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-[17px]">
        <Field
          label="Identifiant"
          type="email"
          placeholder="prenom.nom@aps.fr"
          icon="user"
          value={email}
          onChange={setEmail}
          autoComplete="username"
        />
        <Field
          label="Mot de passe"
          type="password"
          placeholder="••••••••"
          icon="lock"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-semibold text-red">
          Identifiant ou mot de passe invalide
        </p>
      )}

      <div className="my-[12px] mb-[22px] flex justify-end">
        <span className="text-[13px] font-semibold text-redink">
          Mot de passe oublié ?
        </span>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-red px-4 py-[15px] text-[15.5px] font-bold text-white disabled:opacity-70"
      >
        {submitting ? (
          'Connexion…'
        ) : (
          <>
            Embarquer <Icon name="arrowR" size={18} color="#fff" />
          </>
        )}
      </button>
    </form>
  )
}
