'use client'

import { useState } from 'react'

import { trpc } from '@/lib/trpc/client'
import { CsvImportCard } from '@/components/admin/CsvImportCard'

type User = {
  id: string
  email: string
  firstName: string
  role: 'employee' | 'admin'
  storeId: string | null
  createdAt: string | Date
}

type StoreOption = { id: string; name: string }

const TH = 'px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint'
const TD = 'px-4 py-3 text-[14px] text-ink align-middle'
const INPUT =
  'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px] focus:border-ink focus:outline-none'
const LABEL = 'mb-1 block text-[12px] font-medium text-sub'

export function UtilisateursAdmin() {
  const list = trpc.admin.users.list.useQuery()
  const storesQuery = trpc.admin.stores.list.useQuery()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const resetPassword = trpc.admin.users.resetPassword.useMutation({
    onSuccess: (data) => {
      setResetResult({ email: data.email, password: data.password })
      setCopied(false)
    },
  })

  if (list.isLoading) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }
  if (list.isError) {
    return <p className="mt-6 text-[14px] text-red">{list.error.message}</p>
  }

  const users = (list.data ?? []) as User[]
  const stores = (storesQuery.data ?? []) as StoreOption[]
  const storeName = (id: string | null) =>
    id ? (stores.find((s) => s.id === id)?.name ?? '—') : '—'

  return (
    <div className="mt-6 space-y-6">
      <div>
        {creating ? (
          <UserCreateForm stores={stores} onDone={() => setCreating(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-red px-4 py-2 text-[14px] font-semibold text-white"
          >
            Nouvel utilisateur
          </button>
        )}
      </div>

      <CsvImportCard kind="users" />

      {resetResult && (
        <div className="rounded-[14px] border border-red/40 bg-surface p-4">
          <p className="text-[14px] font-semibold text-ink">
            Nouveau mot de passe pour {resetResult.email}
          </p>
          <p className="mt-1 text-[13px] text-sub">
            Transmettez-le maintenant — il ne sera plus affiché ensuite.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <code className="rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-[15px]">
              {resetResult.password}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(resetResult.password)
                setCopied(true)
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
            >
              {copied ? 'Copié ✓' : 'Copier'}
            </button>
            <button
              type="button"
              onClick={() => setResetResult(null)}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-sub hover:bg-sand/50"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
      {resetPassword.isError && (
        <p className="text-[13px] text-red">{resetPassword.error.message}</p>
      )}

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className={TH}>Email</th>
              <th className={TH}>Prénom</th>
              <th className={TH}>Rôle</th>
              <th className={TH}>Magasin</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td className={`${TD} text-sub`} colSpan={5}>
                  Aucun utilisateur.
                </td>
              </tr>
            )}
            {users.map((u) =>
              editing === u.id ? (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className={TD} colSpan={5}>
                    <UserEditForm
                      user={u}
                      stores={stores}
                      onDone={() => setEditing(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className={`${TD} font-medium`}>{u.email}</td>
                  <td className={`${TD} text-sub`}>{u.firstName}</td>
                  <td className={`${TD} text-sub`}>{u.role}</td>
                  <td className={`${TD} text-sub`}>{storeName(u.storeId)}</td>
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    <button
                      type="button"
                      onClick={() => setEditing(u.id)}
                      className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      disabled={resetPassword.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Réinitialiser le mot de passe de ${u.email} ? L'ancien ne fonctionnera plus.`,
                          )
                        ) {
                          resetPassword.mutate({ id: u.id })
                        }
                      }}
                      className="ml-2 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-red hover:bg-sand/50 disabled:opacity-50"
                    >
                      Réinitialiser mdp
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StoreSelect({
  stores,
  value,
  onChange,
}: {
  stores: StoreOption[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <select className={INPUT} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Aucun</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )
}

function UserCreateForm({
  stores,
  onDone,
}: {
  stores: StoreOption[]
  onDone: () => void
}) {
  const utils = trpc.useUtils()
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'employee' | 'admin'>('employee')
  const [storeId, setStoreId] = useState('')

  const create = trpc.admin.users.create.useMutation({
    onSuccess: async () => {
      await utils.admin.users.list.invalidate()
      onDone()
    },
  })

  return (
    <div className="rounded-[14px] border border-line bg-card p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={LABEL}>Email</label>
          <input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Prénom</label>
          <input className={INPUT} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Mot de passe (min. 8)</label>
          <input
            className={INPUT}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Rôle</label>
          <select
            className={INPUT}
            value={role}
            onChange={(e) => setRole(e.target.value as 'employee' | 'admin')}
          >
            <option value="employee">employee</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div>
          <label className={LABEL}>Magasin</label>
          <StoreSelect stores={stores} value={storeId} onChange={setStoreId} />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {create.isError && (
          <span className="mr-auto text-[13px] text-red">{create.error.message}</span>
        )}
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-sub hover:bg-sand/50"
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() =>
            create.mutate({
              email,
              firstName,
              password,
              role,
              storeId: storeId === '' ? null : storeId,
            })
          }
          className="rounded-lg bg-red px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {create.isPending ? 'Création…' : 'Créer'}
        </button>
      </div>
    </div>
  )
}

function UserEditForm({
  user,
  stores,
  onDone,
}: {
  user: User
  stores: StoreOption[]
  onDone: () => void
}) {
  const utils = trpc.useUtils()
  const [firstName, setFirstName] = useState(user.firstName)
  const [role, setRole] = useState<'employee' | 'admin'>(user.role)
  const [storeId, setStoreId] = useState(user.storeId ?? '')
  const [password, setPassword] = useState('')

  const update = trpc.admin.users.update.useMutation({
    onSuccess: async () => {
      await utils.admin.users.list.invalidate()
      onDone()
    },
  })

  return (
    <div className="rounded-[14px] border border-line bg-surface p-5">
      <p className="mb-3 text-[13px] font-medium text-sub">{user.email}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={LABEL}>Prénom</label>
          <input className={INPUT} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Rôle</label>
          <select
            className={INPUT}
            value={role}
            onChange={(e) => setRole(e.target.value as 'employee' | 'admin')}
          >
            <option value="employee">employee</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div>
          <label className={LABEL}>Magasin</label>
          <StoreSelect stores={stores} value={storeId} onChange={setStoreId} />
        </div>
        <div>
          <label className={LABEL}>Nouveau mot de passe (laisser vide = inchangé)</label>
          <input
            className={INPUT}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {update.isError && (
          <span className="mr-auto text-[13px] text-red">{update.error.message}</span>
        )}
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-sub hover:bg-sand/50"
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({
              id: user.id,
              firstName,
              role,
              storeId: storeId === '' ? null : storeId,
              ...(password.trim() !== '' ? { password } : {}),
            })
          }
          className="rounded-lg bg-red px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
