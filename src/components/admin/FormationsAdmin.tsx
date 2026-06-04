'use client'

import { useState } from 'react'

import Link from 'next/link'

import { trpc } from '@/lib/trpc/client'
import { nextSlug } from '@/lib/slug'

type Formation = {
  id: string
  slug: string
  name: string
  tag: string
  icon: string
  description: string
  kind: 'sharepoint' | 'pdf'
  sharepointUrl: string | null
  docCount: number
  order: number
}

const ICON_HINT = 'cart · box · euro · layers · user · truck · headset · shield'

const TH = 'px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint'
const TD = 'px-4 py-3 text-[14px] text-ink align-middle'
const INPUT =
  'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px] focus:border-ink focus:outline-none'
const LABEL = 'mb-1 block text-[12px] font-medium text-sub'

type FormValues = {
  name: string
  slug: string
  tag: string
  icon: string
  description: string
  kind: 'sharepoint' | 'pdf'
  sharepointUrl: string
  docCount: number
  order: number
}

const EMPTY: FormValues = {
  name: '',
  slug: '',
  tag: '',
  icon: 'book',
  description: '',
  kind: 'sharepoint',
  sharepointUrl: '',
  docCount: 0,
  order: 0,
}

function toValues(f: Formation): FormValues {
  return {
    name: f.name,
    slug: f.slug,
    tag: f.tag,
    icon: f.icon,
    description: f.description,
    kind: f.kind,
    sharepointUrl: f.sharepointUrl ?? '',
    docCount: f.docCount,
    order: f.order,
  }
}

export function FormationsAdmin() {
  const list = trpc.admin.formations.list.useQuery()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const del = trpc.admin.formations.delete.useMutation({
    onSuccess: () => utils.admin.formations.list.invalidate(),
  })

  if (list.isLoading) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }
  if (list.isError) {
    return <p className="mt-6 text-[14px] text-red">{list.error.message}</p>
  }

  const formations = (list.data ?? []) as Formation[]

  return (
    <div className="mt-6 space-y-6">
      <div>
        {creating ? (
          <FormationForm
            mode="create"
            initial={EMPTY}
            onDone={() => setCreating(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-red px-4 py-2 text-[14px] font-semibold text-white"
          >
            Nouvelle formation
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className={TH}>Ordre</th>
              <th className={TH}>Nom</th>
              <th className={TH}>Slug</th>
              <th className={TH}>Tag</th>
              <th className={TH}>Type</th>
              <th className={TH}>Docs</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {formations.length === 0 && (
              <tr>
                <td className={`${TD} text-sub`} colSpan={7}>
                  Aucune formation.
                </td>
              </tr>
            )}
            {formations.map((f) =>
              editing === f.id ? (
                <tr key={f.id} className="border-b border-line last:border-0">
                  <td className={TD} colSpan={7}>
                    <FormationForm
                      mode="edit"
                      id={f.id}
                      initial={toValues(f)}
                      onDone={() => setEditing(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={f.id} className="border-b border-line last:border-0">
                  <td className={`${TD} text-sub`}>{f.order}</td>
                  <td className={`${TD} font-medium`}>{f.name}</td>
                  <td className={`${TD} text-sub`}>{f.slug}</td>
                  <td className={`${TD} text-sub`}>{f.tag}</td>
                  <td className={`${TD} text-sub`}>{f.kind}</td>
                  <td className={`${TD} text-sub`}>{f.docCount}</td>
                  <td className={`${TD} text-right`}>
                    <div className="flex justify-end gap-2">
                      {f.kind === 'pdf' && (
                        <Link
                          href={`/admin/formations/${f.id}`}
                          className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
                        >
                          Gérer les documents
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditing(f.id)}
                        className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        disabled={del.isPending}
                        onClick={() => {
                          if (window.confirm(`Supprimer « ${f.name} » ?`)) {
                            del.mutate({ id: f.id })
                          }
                        }}
                        className="rounded-lg border border-redSoft px-3 py-1.5 text-[13px] font-medium text-red hover:bg-redSoft disabled:opacity-50"
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {del.isError && (
          <p className="border-t border-line px-4 py-2 text-[13px] text-red">
            {del.error.message}
          </p>
        )}
      </div>
    </div>
  )
}

function FormationForm({
  mode,
  id,
  initial,
  onDone,
}: {
  mode: 'create' | 'edit'
  id?: string
  initial: FormValues
  onDone: () => void
}) {
  const utils = trpc.useUtils()
  const [v, setV] = useState<FormValues>(initial)
  const [slugTouched, setSlugTouched] = useState(false)

  const onSuccess = async () => {
    await utils.admin.formations.list.invalidate()
    setSlugTouched(false)
    onDone()
  }
  const create = trpc.admin.formations.create.useMutation({ onSuccess })
  const update = trpc.admin.formations.update.useMutation({ onSuccess })
  const active = mode === 'create' ? create : update

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }))
  }

  function onNameChange(name: string) {
    setV((prev) => ({
      ...prev,
      name,
      // CREATE only: auto-fill slug from the name until the user edits it.
      slug: mode === 'create' ? nextSlug(name, slugTouched, prev.slug) : prev.slug,
    }))
  }

  function onSlugChange(slug: string) {
    if (mode === 'create') setSlugTouched(true)
    setV((prev) => ({ ...prev, slug }))
  }

  function submit() {
    const sharepointUrl =
      v.kind === 'sharepoint' && v.sharepointUrl.trim() !== ''
        ? v.sharepointUrl.trim()
        : null
    if (mode === 'create') {
      create.mutate({
        name: v.name,
        slug: v.slug,
        tag: v.tag,
        icon: v.icon,
        description: v.description,
        kind: v.kind,
        sharepointUrl,
        docCount: v.docCount,
        order: v.order,
      })
    } else if (id) {
      update.mutate({
        id,
        name: v.name,
        slug: v.slug,
        tag: v.tag,
        icon: v.icon,
        description: v.description,
        kind: v.kind,
        sharepointUrl,
        docCount: v.docCount,
        order: v.order,
      })
    }
  }

  return (
    <div className="rounded-[14px] border border-line bg-card p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={LABEL}>Nom</label>
          <input className={INPUT} value={v.name} onChange={(e) => onNameChange(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Slug</label>
          <input className={INPUT} value={v.slug} onChange={(e) => onSlugChange(e.target.value)} />
          {mode === 'create' && (
            <p className="mt-1 text-[11.5px] text-faint">
              Identifiant d&apos;URL — généré depuis le nom, modifiable.
            </p>
          )}
        </div>
        <div>
          <label className={LABEL}>Tag</label>
          <input className={INPUT} value={v.tag} onChange={(e) => set('tag', e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Icône</label>
          <input className={INPUT} value={v.icon} onChange={(e) => set('icon', e.target.value)} />
          <p className="mt-1 text-[11.5px] text-faint">Noms valides : {ICON_HINT}</p>
        </div>
        <div className="md:col-span-2">
          <label className={LABEL}>Description</label>
          <textarea
            className={`${INPUT} min-h-[70px]`}
            value={v.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Type</label>
          <select
            className={INPUT}
            value={v.kind}
            onChange={(e) => set('kind', e.target.value as FormValues['kind'])}
          >
            <option value="sharepoint">sharepoint</option>
            <option value="pdf">pdf</option>
          </select>
        </div>
        {v.kind === 'sharepoint' && (
          <div>
            <label className={LABEL}>URL SharePoint</label>
            <input
              className={INPUT}
              value={v.sharepointUrl}
              onChange={(e) => set('sharepointUrl', e.target.value)}
            />
          </div>
        )}
        <div>
          <label className={LABEL}>Nombre de documents</label>
          <input
            type="number"
            className={INPUT}
            value={v.docCount}
            onChange={(e) => set('docCount', Number(e.target.value))}
          />
        </div>
        <div>
          <label className={LABEL}>Ordre</label>
          <input
            type="number"
            className={INPUT}
            value={v.order}
            onChange={(e) => set('order', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {active.isError && (
          <span className="mr-auto text-[13px] text-red">{active.error.message}</span>
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
          disabled={active.isPending}
          onClick={submit}
          className="rounded-lg bg-red px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {active.isPending ? 'Enregistrement…' : mode === 'create' ? 'Créer' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
