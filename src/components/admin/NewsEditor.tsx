'use client'

import { useEffect, useRef, useState } from 'react'

import Link from 'next/link'

import { trpc } from '@/lib/trpc/client'
import { Icon } from '@/components/ui/Icon'
import { TiptapEditor } from '@/components/admin/TiptapEditor'

const INPUT =
  'w-full rounded-lg border border-line bg-card px-3 py-2 text-[14px] focus:border-ink focus:outline-none'
const LABEL = 'mb-1 block text-[12px] font-medium text-sub'

/** Maps cover-upload HTTP error statuses to a French message. */
function coverErrorMessage(status: number): string {
  if (status === 413) return 'Image trop lourde (max 5 Mo)'
  if (status === 415) return "Format d'image non supporté"
  return "Échec de l'envoi de l'image"
}

export function NewsEditor({ id }: { id: string }) {
  const utils = trpc.useUtils()
  const query = trpc.admin.news.byId.useQuery({ id })

  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [contentHtml, setContentHtml] = useState('')

  // Sync local form state from the server payload exactly once (when it loads).
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current || !query.data) return
    hydratedRef.current = true
    setTitle(query.data.title)
    setExcerpt(query.data.excerpt ?? '')
    setAuthorName(query.data.authorName ?? '')
    setContentHtml(query.data.contentHtml ?? '')
  }, [query.data])

  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const update = trpc.admin.news.update.useMutation({
    onSuccess: async () => {
      await utils.admin.news.byId.invalidate({ id })
      await utils.admin.news.list.invalidate()
      setSaved(true)
      setDirty(false)
    },
  })

  const setStatus = trpc.admin.news.setStatus.useMutation({
    onSuccess: async () => {
      await utils.admin.news.byId.invalidate({ id })
      await utils.admin.news.list.invalidate()
    },
  })

  const [coverError, setCoverError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  async function onCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    setCoverError(null)
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/admin/news/${id}/cover`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        setCoverError(coverErrorMessage(res.status))
        return
      }
      await utils.admin.news.byId.invalidate({ id })
    } catch {
      setCoverError("Échec de l'envoi de l'image")
    } finally {
      setUploading(false)
    }
  }

  // Warn before closing the tab while there are unsaved edits. In-app Link
  // navigation cannot be intercepted in the App Router; "Publier" is gated
  // on dirty instead.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (query.isLoading) {
    return <p className="text-[14px] text-sub">Chargement…</p>
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <p className="text-[14px] text-red">{query.error.message}</p>
        <Link href="/admin/actualites" className="text-[14px] text-redink underline">
          Retour aux actualités
        </Link>
      </div>
    )
  }

  const article = query.data
  if (!article) {
    return <p className="text-[14px] text-sub">Chargement…</p>
  }
  const isPublished = article.status === 'published'
  // Cache-bust the cover so a fresh upload shows immediately.
  const coverSrc = article.coverImageUrl
    ? `${article.coverImageUrl}?v=${new Date(article.updatedAt).getTime()}`
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/admin/actualites"
          className="flex items-center gap-1.5 text-[14px] font-medium text-sub hover:text-ink"
        >
          <Icon name="chevronL" size={16} />
          Retour aux actualités
        </Link>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
              isPublished ? 'bg-sand text-ink' : 'bg-redsoft text-redink'
            }`}
          >
            {isPublished ? 'Publié' : 'Brouillon'}
          </span>
          {isPublished && (
            <Link
              href={`/actualites/${article.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
            >
              Voir
            </Link>
          )}
          {dirty && (
            <span className="text-[12px] font-medium text-redink">
              Modifications non enregistrées
            </span>
          )}
          <button
            type="button"
            disabled={setStatus.isPending || dirty}
            title={dirty ? 'Enregistrez vos modifications avant de publier' : undefined}
            onClick={() =>
              setStatus.mutate({ id, status: isPublished ? 'draft' : 'published' })
            }
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50 disabled:opacity-50"
          >
            {isPublished ? 'Dépublier' : 'Publier'}
          </button>
        </div>
      </div>

      <div className="rounded-[14px] border border-line bg-card p-6">
        <div className="space-y-5">
          <div>
            <label htmlFor="news-title" className={LABEL}>Titre</label>
            <input
              id="news-title"
              className={`${INPUT} text-[18px] font-semibold`}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setSaved(false)
                setDirty(true)
              }}
            />
          </div>

          <div>
            <label htmlFor="news-excerpt" className={LABEL}>Chapô</label>
            <textarea
              id="news-excerpt"
              className={`${INPUT} min-h-[70px]`}
              value={excerpt}
              onChange={(e) => {
                setExcerpt(e.target.value)
                setSaved(false)
                setDirty(true)
              }}
            />
          </div>

          <div>
            <label htmlFor="news-author" className={LABEL}>Auteur</label>
            <input
              id="news-author"
              className={INPUT}
              value={authorName}
              onChange={(e) => {
                setAuthorName(e.target.value)
                setSaved(false)
                setDirty(true)
              }}
            />
          </div>

          <div>
            <label htmlFor="news-cover" className={LABEL}>Image de couverture</label>
            {coverSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverSrc}
                alt="Couverture"
                className="mb-3 max-h-48 rounded-lg border border-line object-cover"
              />
            )}
            <input
              id="news-cover"
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={onCoverChange}
              className="block text-[13px] text-sub file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink hover:file:bg-sand/50"
            />
            {uploading && <p className="mt-1 text-[12px] text-sub">Envoi en cours…</p>}
            {coverError && <p className="mt-1 text-[13px] text-red">{coverError}</p>}
          </div>

          <div>
            <label className={LABEL}>Contenu</label>
            <TiptapEditor
              value={contentHtml}
              onChange={(html) => {
                setContentHtml(html)
                setSaved(false)
                setDirty(true)
              }}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          {update.isError && (
            <span className="mr-auto text-[13px] text-red">{update.error.message}</span>
          )}
          {saved && !update.isPending && (
            <span className="text-[13px] font-medium text-sub">Enregistré</span>
          )}
          <button
            type="button"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({ id, title, excerpt, authorName, contentHtml })
            }
            className="rounded-lg bg-red px-5 py-2 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
