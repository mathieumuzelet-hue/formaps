'use client'

import { useEffect, useRef, useState } from 'react'

import { trpc } from '@/lib/trpc/client'
import { buildFaqCsv } from '@/lib/admin/faq-csv'
import { downloadCsv } from '@/lib/admin/download-csv'
import { slugify } from '@/lib/slug'
import type { FaqItem } from '@/lib/faq/types'

const FIELD =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink'

const GENERATE_MORE_ERRORS: Record<string, string> = {
  no_new_pairs:
    'Aucune question inédite — la FAQ couvre probablement déjà tout le document.',
  output_truncated:
    'Génération incomplète (limite de sortie atteinte). Réessayez : les questions déjà présentes seront évitées.',
  generation_failed: 'La génération a échoué. Réessayez.',
  anthropic_not_configured: 'Clé Anthropic absente — configurez ANTHROPIC_API_KEY.',
}

export function FaqDraftEditor({ draftId }: { draftId: string }) {
  const utils = trpc.useUtils()
  const draft = trpc.admin.faqBuilder.get.useQuery({ id: draftId })
  const update = trpc.admin.faqBuilder.updateItems.useMutation()
  const generateMore = trpc.admin.faqBuilder.generateMore.useMutation()

  const [items, setItems] = useState<FaqItem[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'status' | 'alert'; text: string } | null>(
    null,
  )

  // Hydrate local state once from the server payload (then local state wins).
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current || !draft.data) return
    hydratedRef.current = true
    setItems(draft.data.items)
  }, [draft.data])

  // Block accidental tab close while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  if (draft.isError && items === null) {
    return <p className="mt-6 text-[14px] text-red">{draft.error.message}</p>
  }
  if (draft.isLoading || items === null) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }

  const list = items ?? []
  const hasEmpty = list.some((it) => !it.question.trim() || !it.answer.trim())
  const busy = generateMore.isPending || update.isPending

  const edit = (id: string, patch: Partial<Pick<FaqItem, 'question' | 'answer'>>) => {
    setItems((prev) => (prev ?? []).map((it) => (it.id === id ? { ...it, ...patch } : it)))
    setDirty(true)
    setBanner(null)
  }
  const remove = (id: string) => {
    setItems((prev) => (prev ?? []).filter((it) => it.id !== id))
    setDirty(true)
  }
  const move = (index: number, delta: -1 | 1) => {
    setItems((prev) => {
      const next = [...(prev ?? [])]
      const j = index + delta
      if (j < 0 || j >= next.length) return next
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
    setDirty(true)
  }
  const addPair = () => {
    setItems((prev) => [
      ...(prev ?? []),
      { id: crypto.randomUUID(), question: '', answer: '', origin: 'manual' },
    ])
    setDirty(true)
  }

  const save = () => {
    setBanner(null)
    update.mutate(
      { id: draftId, items: list },
      {
        onSuccess: () => {
          setDirty(false)
          setBanner({ kind: 'status', text: 'Brouillon enregistré.' })
          utils.admin.faqBuilder.get.invalidate({ id: draftId })
        },
        onError: () =>
          setBanner({ kind: 'alert', text: "L'enregistrement a échoué. Réessayez." }),
      },
    )
  }

  const more = () => {
    setBanner(null)
    generateMore.mutate(
      { draftId },
      {
        onSuccess: (res) => {
          setItems(res.items)
          setDirty(false)
          setBanner({
            kind: 'status',
            text: `${res.added} paire${res.added > 1 ? 's' : ''} ajoutée${res.added > 1 ? 's' : ''}.`,
          })
          utils.admin.faqBuilder.get.invalidate({ id: draftId })
        },
        onError: (err) =>
          setBanner({
            kind: err.message === 'no_new_pairs' ? 'status' : 'alert',
            text: GENERATE_MORE_ERRORS[err.message] ?? 'La génération a échoué. Réessayez.',
          }),
      },
    )
  }

  const exportCsv = () => {
    const csv = buildFaqCsv(list)
    const date = new Date().toISOString().slice(0, 10)
    downloadCsv(`faq-${slugify(draft.data!.sourceFilename)}-${date}.csv`, csv)
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-sub">
          {list.length} paire{list.length > 1 ? 's' : ''} — {draft.data!.sourceFilename}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addPair}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink disabled:opacity-50"
          >
            Ajouter une paire
          </button>
          <button
            type="button"
            onClick={more}
            disabled={dirty || busy}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink disabled:opacity-50"
          >
            {busy ? 'Génération…' : 'Générer plus'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || hasEmpty || busy}
            className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={dirty || busy || list.length === 0}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink disabled:opacity-50"
          >
            Exporter CSV
          </button>
        </div>
      </div>

      {hasEmpty && (
        <p className="text-[13px] text-red">
          Des paires ont des champs vides — complétez-les ou supprimez-les avant
          d&apos;enregistrer.
        </p>
      )}
      {dirty && !hasEmpty && (
        <p className="text-[13px] text-faint">
          Modifications non enregistrées — « Générer plus » et l&apos;export sont
          désactivés tant que le brouillon n&apos;est pas enregistré.
        </p>
      )}
      {banner && (
        <p
          role={banner.kind}
          className={`text-[13px] ${banner.kind === 'alert' ? 'text-red' : 'text-sub'}`}
        >
          {banner.text}
        </p>
      )}

      <ul className="space-y-3">
        {list.map((it, index) => (
          <li key={it.id} className="rounded-[14px] border border-line bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="rounded-full bg-surface px-2 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                {it.origin === 'generated' ? 'générée' : 'manuelle'}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={busy || index === 0}
                  aria-label={`Monter la paire ${index + 1}`}
                  className="rounded px-2 py-1 text-[13px] text-sub disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={busy || index === list.length - 1}
                  aria-label={`Descendre la paire ${index + 1}`}
                  className="rounded px-2 py-1 text-[13px] text-sub disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  disabled={busy}
                  aria-label={`Supprimer la paire ${index + 1}`}
                  className="rounded px-2 py-1 text-[13px] text-red"
                >
                  Supprimer
                </button>
              </div>
            </div>
            <label className="block text-[12.5px] font-semibold text-faint">
              Question
              <textarea
                value={it.question}
                onChange={(e) => edit(it.id, { question: e.target.value })}
                disabled={busy}
                rows={2}
                className={`${FIELD} mt-1`}
              />
            </label>
            <label className="mt-3 block text-[12.5px] font-semibold text-faint">
              Réponse
              <textarea
                value={it.answer}
                onChange={(e) => edit(it.id, { answer: e.target.value })}
                disabled={busy}
                rows={4}
                className={`${FIELD} mt-1`}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
