'use client'

import { trpc } from '@/lib/trpc/client'
import { buildFaqGapsCsv, type FaqGapGroup } from '@/lib/admin/faq-gaps'
import { downloadCsv } from '@/lib/admin/download-csv'

const TH = 'px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint'
const TD = 'px-4 py-3 text-[14px] text-ink align-middle'

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('fr-FR')
}

export function FaqGapsAdmin() {
  const list = trpc.admin.faqGaps.list.useQuery()

  if (list.isLoading) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }
  if (list.isError) {
    return <p className="mt-6 text-[14px] text-red">{list.error.message}</p>
  }

  const groups = (list.data ?? []) as FaqGapGroup[]

  const exportCsv = () => {
    const csv = buildFaqGapsCsv(
      groups.map((g) => ({ ...g, lastAskedAt: new Date(g.lastAskedAt) })),
    )
    downloadCsv(`faq-gaps-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-sub">
          {groups.length} question{groups.length > 1 ? 's' : ''} groupée
          {groups.length > 1 ? 's' : ''} sur les 30 derniers jours
        </p>
        <button
          type="button"
          onClick={exportCsv}
          disabled={groups.length === 0}
          className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          Exporter CSV
        </button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className={TH}>Question</th>
              <th className={TH}>Occurrences</th>
              <th className={TH}>Dernière date</th>
              <th className={TH}>Score max</th>
              <th className={TH}>Sources</th>
              <th className={TH}>👎</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td className={`${TD} text-sub`} colSpan={6}>
                  Aucun trou détecté sur les 30 derniers jours.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={g.question} className="border-b border-line last:border-0">
                <td className={`${TD} w-full`}>{g.question}</td>
                <td className={TD}>{g.count}</td>
                <td className={`${TD} whitespace-nowrap`}>{formatDate(g.lastAskedAt)}</td>
                <td className={TD}>{g.scoreMax === null ? '—' : g.scoreMax.toFixed(2)}</td>
                <td className={TD}>{g.retrievalCount}</td>
                <td className={TD}>{g.dislikes > 0 ? g.dislikes : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
