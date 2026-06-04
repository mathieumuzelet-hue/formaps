'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { trpc } from '@/lib/trpc/client'

type NewsRow = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  coverImageUrl: string | null
  status: 'draft' | 'published'
  authorName: string | null
  publishedAt: Date | string | null
  updatedAt: Date | string
}

const TH = 'px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint'
const TD = 'px-4 py-3 text-[14px] text-ink align-middle'

function formatDate(value: Date | string | null): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  if (status === 'published') {
    return (
      <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-semibold text-ink">
        Publié
      </span>
    )
  }
  return (
    <span className="rounded-full bg-redsoft px-2.5 py-0.5 text-[12px] font-semibold text-redink">
      Brouillon
    </span>
  )
}

export function NewsAdmin() {
  const router = useRouter()
  const utils = trpc.useUtils()
  const list = trpc.admin.news.list.useQuery()

  const create = trpc.admin.news.create.useMutation({
    onSuccess: (row) => {
      router.push(`/admin/actualites/${row.id}`)
    },
  })
  const setStatus = trpc.admin.news.setStatus.useMutation({
    onSuccess: () => utils.admin.news.list.invalidate(),
  })
  const del = trpc.admin.news.delete.useMutation({
    onSuccess: () => utils.admin.news.list.invalidate(),
  })

  if (list.isLoading) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }
  if (list.isError) {
    return <p className="mt-6 text-[14px] text-red">{list.error.message}</p>
  }

  const articles = (list.data ?? []) as NewsRow[]

  return (
    <div className="mt-6 space-y-6">
      <div>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => create.mutate({ title: 'Nouvelle actualité' })}
          className="rounded-lg bg-red px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-50"
        >
          {create.isPending ? 'Création…' : 'Nouvelle actualité'}
        </button>
        {create.isError && (
          <span className="ml-3 text-[13px] text-red">{create.error.message}</span>
        )}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className={TH}>Titre</th>
              <th className={TH}>Statut</th>
              <th className={TH}>Auteur</th>
              <th className={TH}>Modifié</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {articles.length === 0 && (
              <tr>
                <td className={`${TD} text-sub`} colSpan={5}>
                  Aucune actualité pour le moment.
                </td>
              </tr>
            )}
            {articles.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className={`${TD} font-medium`}>{a.title}</td>
                <td className={TD}>
                  <StatusBadge status={a.status} />
                </td>
                <td className={`${TD} text-sub`}>{a.authorName ?? '—'}</td>
                <td className={`${TD} text-sub`}>{formatDate(a.updatedAt)}</td>
                <td className={`${TD} text-right`}>
                  <div className="flex justify-end gap-2">
                    <Link
                      href={`/admin/actualites/${a.id}`}
                      className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
                    >
                      Modifier
                    </Link>
                    <button
                      type="button"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        setStatus.mutate({
                          id: a.id,
                          status: a.status === 'published' ? 'draft' : 'published',
                        })
                      }
                      className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50 disabled:opacity-50"
                    >
                      {a.status === 'published' ? 'Dépublier' : 'Publier'}
                    </button>
                    <button
                      type="button"
                      disabled={del.isPending}
                      onClick={() => {
                        if (window.confirm(`Supprimer « ${a.title} » ?`)) {
                          del.mutate({ id: a.id })
                        }
                      }}
                      className="rounded-lg border border-redsoft px-3 py-1.5 text-[13px] font-medium text-red hover:bg-redsoft disabled:opacity-50"
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(setStatus.isError || del.isError) && (
          <p className="border-t border-line px-4 py-2 text-[13px] text-red">
            {setStatus.error?.message ?? del.error?.message}
          </p>
        )}
      </div>
    </div>
  )
}
