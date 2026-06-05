'use client'

import { useState } from 'react'

import { trpc } from '@/lib/trpc/client'

type Suggestion = {
  id: string
  text: string
  sortOrder: number
  isActive: boolean
}

const TH = 'px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint'
const TD = 'px-4 py-3 text-[14px] text-ink align-middle'
const INPUT =
  'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px] focus:border-ink focus:outline-none'

export function SuggestionsAdmin() {
  const list = trpc.admin.brainSuggestions.list.useQuery()
  const utils = trpc.useUtils()
  const [editing, setEditing] = useState<string | null>(null)

  const reorder = trpc.admin.brainSuggestions.reorder.useMutation({
    onSuccess: () => utils.admin.brainSuggestions.list.invalidate(),
  })
  const update = trpc.admin.brainSuggestions.update.useMutation({
    onSuccess: () => utils.admin.brainSuggestions.list.invalidate(),
  })
  const remove = trpc.admin.brainSuggestions.delete.useMutation({
    onSuccess: () => utils.admin.brainSuggestions.list.invalidate(),
  })

  if (list.isLoading) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }
  if (list.isError) {
    return <p className="mt-6 text-[14px] text-red">{list.error.message}</p>
  }

  const suggestions = (list.data ?? []) as Suggestion[]

  /** Swap with the neighbour and persist the full ordering. */
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= suggestions.length) return
    const ids = suggestions.map((s) => s.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorder.mutate({ ids })
  }

  return (
    <div className="mt-6 space-y-6">
      <SuggestionCreateForm />

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className={TH}>Ordre</th>
              <th className={TH}>Question</th>
              <th className={TH}>Active</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {suggestions.length === 0 && (
              <tr>
                <td className={`${TD} text-sub`} colSpan={4}>
                  Aucune suggestion — le chat affiche les questions par défaut.
                </td>
              </tr>
            )}
            {suggestions.map((s, i) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className={TD}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Monter"
                      disabled={i === 0 || reorder.isPending}
                      onClick={() => move(i, -1)}
                      className="rounded px-2 py-0.5 text-[13px] text-sub hover:bg-sand/50 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Descendre"
                      disabled={i === suggestions.length - 1 || reorder.isPending}
                      onClick={() => move(i, 1)}
                      className="rounded px-2 py-0.5 text-[13px] text-sub hover:bg-sand/50 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className={`${TD} w-full`}>
                  {editing === s.id ? (
                    <SuggestionEditField
                      suggestion={s}
                      onDone={() => setEditing(null)}
                    />
                  ) : (
                    s.text
                  )}
                </td>
                <td className={TD}>
                  <input
                    type="checkbox"
                    checked={s.isActive}
                    disabled={update.isPending}
                    onChange={() => update.mutate({ id: s.id, isActive: !s.isActive })}
                    aria-label={`Activer ${s.text}`}
                  />
                </td>
                <td className={`${TD} whitespace-nowrap text-right`}>
                  {editing !== s.id && (
                    <button
                      type="button"
                      onClick={() => setEditing(s.id)}
                      className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
                    >
                      Modifier
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm('Supprimer cette suggestion ?')) {
                        remove.mutate({ id: s.id })
                      }
                    }}
                    className="ml-2 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-red hover:bg-sand/50 disabled:opacity-50"
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(update.isError || remove.isError || reorder.isError) && (
        <p className="text-[13px] text-red">
          {update.error?.message ?? remove.error?.message ?? reorder.error?.message}
        </p>
      )}
    </div>
  )
}

function SuggestionCreateForm() {
  const utils = trpc.useUtils()
  const [text, setText] = useState('')

  const create = trpc.admin.brainSuggestions.create.useMutation({
    onSuccess: async () => {
      setText('')
      await utils.admin.brainSuggestions.list.invalidate()
    },
  })

  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <h2 className="text-[14px] font-semibold text-ink">Nouvelle suggestion</h2>
      <form
        className="mt-3 flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim() === '') return
          create.mutate({ text: text.trim() })
        }}
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            Question (max 200 caractères)
          </span>
          <input
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex. : Comment paramétrer une caisse Mercalys ?"
            className={INPUT}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending || text.trim() === ''}
          className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {create.isPending ? 'Ajout…' : 'Ajouter'}
        </button>
      </form>
      {create.isError && (
        <p className="mt-2 text-[13px] text-red">{create.error.message}</p>
      )}
    </div>
  )
}

function SuggestionEditField({
  suggestion,
  onDone,
}: {
  suggestion: Suggestion
  onDone: () => void
}) {
  const utils = trpc.useUtils()
  const [text, setText] = useState(suggestion.text)

  const update = trpc.admin.brainSuggestions.update.useMutation({
    onSuccess: async () => {
      await utils.admin.brainSuggestions.list.invalidate()
      onDone()
    },
  })

  return (
    <div className="flex items-center gap-2">
      <input
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        className={INPUT}
      />
      <button
        type="button"
        onClick={onDone}
        className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-sub hover:bg-sand/50"
      >
        Annuler
      </button>
      <button
        type="button"
        disabled={update.isPending || text.trim() === ''}
        onClick={() => update.mutate({ id: suggestion.id, text: text.trim() })}
        className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        {update.isPending ? '…' : 'OK'}
      </button>
    </div>
  )
}
