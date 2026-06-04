'use client'

import { useState } from 'react'

import { trpc } from '@/lib/trpc/client'
import { stepOptions } from '@/lib/admin/store-step-options'
import { CsvImportCard } from '@/components/admin/CsvImportCard'

type Store = {
  id: string
  name: string
  basculeDate: string
  currentStep: number
  updatedAt: string | Date
}

/** Format a date-ish value to `YYYY-MM-DD` for `<input type="date">`. */
function toDateInput(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  // Postgres `date` already serialises as `YYYY-MM-DD`; keep just that prefix.
  return String(value).slice(0, 10)
}

function formatUpdatedAt(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR')
}

const OPTIONS = stepOptions()

const TH = 'px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint'
const TD = 'px-4 py-3 text-[14px] text-ink align-middle'

export function MagasinsAdmin() {
  const list = trpc.admin.stores.list.useQuery()
  const [editing, setEditing] = useState<string | null>(null)

  if (list.isLoading) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }
  if (list.isError) {
    return <p className="mt-6 text-[14px] text-red">{list.error.message}</p>
  }

  const stores = (list.data ?? []) as Store[]

  return (
    <div className="mt-6 space-y-6">
      <StoreCreateForm />
      <CsvImportCard kind="stores" />
      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line bg-surface">
            <th className={TH}>Magasin</th>
            <th className={TH}>Date de bascule</th>
            <th className={TH}>Étape</th>
            <th className={TH}>Mis à jour</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {stores.length === 0 && (
            <tr>
              <td className={`${TD} text-sub`} colSpan={5}>
                Aucun magasin.
              </td>
            </tr>
          )}
          {stores.map((store) =>
            editing === store.id ? (
              <StoreEditRow
                key={store.id}
                store={store}
                onDone={() => setEditing(null)}
              />
            ) : (
              <tr key={store.id} className="border-b border-line last:border-0">
                <td className={`${TD} font-medium`}>{store.name}</td>
                <td className={`${TD} text-sub`}>{toDateInput(store.basculeDate)}</td>
                <td className={`${TD} text-sub`}>
                  {OPTIONS[store.currentStep]?.label ?? store.currentStep}
                </td>
                <td className={`${TD} text-sub`}>{formatUpdatedAt(store.updatedAt)}</td>
                <td className={`${TD} text-right`}>
                  <button
                    type="button"
                    onClick={() => setEditing(store.id)}
                    className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
                  >
                    Modifier
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

function StoreCreateForm() {
  const utils = trpc.useUtils()
  const [name, setName] = useState('')
  const [basculeDate, setBasculeDate] = useState('')
  const [currentStep, setCurrentStep] = useState(0)

  const create = trpc.admin.stores.create.useMutation({
    onSuccess: async () => {
      setName('')
      setBasculeDate('')
      setCurrentStep(0)
      await utils.admin.stores.list.invalidate()
    },
  })

  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <h2 className="text-[14px] font-semibold text-ink">Nouveau magasin</h2>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate({ name, basculeDate, currentStep })
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            Magasin
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du magasin"
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            Date de bascule
          </span>
          <input
            type="date"
            value={basculeDate}
            onChange={(e) => setBasculeDate(e.target.value)}
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            Étape
          </span>
          <select
            value={currentStep}
            onChange={(e) => setCurrentStep(Number(e.target.value))}
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px]"
          >
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {create.isPending ? 'Création…' : 'Créer'}
        </button>
        {create.isError && (
          <span className="w-full text-[13px] text-red">{create.error.message}</span>
        )}
      </form>
    </div>
  )
}

function StoreEditRow({ store, onDone }: { store: Store; onDone: () => void }) {
  const utils = trpc.useUtils()
  const [name, setName] = useState(store.name)
  const [basculeDate, setBasculeDate] = useState(toDateInput(store.basculeDate))
  const [currentStep, setCurrentStep] = useState(store.currentStep)

  const update = trpc.admin.stores.update.useMutation({
    onSuccess: async () => {
      await utils.admin.stores.list.invalidate()
      onDone()
    },
  })

  return (
    <tr className="border-b border-line bg-surface last:border-0">
      <td className={TD}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px]"
        />
      </td>
      <td className={TD}>
        <input
          type="date"
          value={basculeDate}
          onChange={(e) => setBasculeDate(e.target.value)}
          className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px]"
        />
      </td>
      <td className={TD}>
        <select
          value={currentStep}
          onChange={(e) => setCurrentStep(Number(e.target.value))}
          className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px]"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className={TD} colSpan={2}>
        <div className="flex items-center justify-end gap-2">
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
              update.mutate({ id: store.id, name, basculeDate, currentStep })
            }
            className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </td>
    </tr>
  )
}
