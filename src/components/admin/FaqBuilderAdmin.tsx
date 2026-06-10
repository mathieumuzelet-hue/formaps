'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { trpc } from '@/lib/trpc/client'

const ERROR_MESSAGES: Record<string, string> = {
  empty_text:
    'Aucun texte exploitable dans ce document — il est probablement scanné. ' +
    "Vérifiez le verdict OCR dans le Labo d'embed.",
  unreadable_document: 'Document illisible — protégé ou corrompu.',
  invalid_type: 'Format non pris en charge : PDF ou .docx uniquement.',
  file_too_large: 'Fichier trop volumineux (25 Mo max).',
  anthropic_not_configured: 'Clé Anthropic absente — configurez ANTHROPIC_API_KEY.',
  generation_failed: 'La génération a échoué. Réessayez.',
  output_truncated:
    'Document trop riche : la génération a dépassé la limite de sortie. ' +
    'Scindez le document et réessayez.',
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('fr-FR')
}

export function FaqBuilderAdmin() {
  const router = useRouter()
  const utils = trpc.useUtils()
  const list = trpc.admin.faqBuilder.list.useQuery()
  const del = trpc.admin.faqBuilder.delete.useMutation({
    onSuccess: () => utils.admin.faqBuilder.list.invalidate(),
    onError: () => setError('La suppression a échoué. Réessayez.'),
  })

  const [file, setFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    if (!file) return
    if (file.size > 25 * 1024 * 1024) {
      setError('Fichier trop volumineux (25 Mo max).')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/admin/faq-builder', { method: 'POST', body: form })
      const body = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || !body.id) {
        setError(ERROR_MESSAGES[body.error ?? ''] ?? 'Erreur inattendue. Réessayez.')
        return
      }
      router.push(`/admin/faq-builder/${body.id}`)
    } catch {
      setError('Erreur réseau. Réessayez.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-[14px] border border-line bg-card p-5">
        <h2 className="text-[15px] font-semibold text-ink">Nouveau document</h2>
        <p className="mt-1 text-[13px] text-sub">
          PDF ou .docx, 25 Mo max. La génération prend 30 à 60 secondes (Claude
          Sonnet 4.6).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".pdf,.docx"
            aria-label="Document source"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setError(null)
            }}
            className="text-[13px] text-ink"
          />
          <button
            type="button"
            onClick={generate}
            disabled={!file || generating}
            className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {generating ? 'Génération en cours…' : 'Générer la FAQ'}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-red">
            {error}
          </p>
        )}
      </div>

      {list.isLoading && <p className="text-[14px] text-sub">Chargement…</p>}
      {list.isError && <p className="text-[14px] text-red">{list.error.message}</p>}
      {list.data && list.data.length === 0 && (
        <p className="text-[14px] text-sub">Aucun brouillon — uploadez un document.</p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="space-y-2">
          {list.data.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded-[14px] border border-line bg-card px-4 py-3"
            >
              <div>
                <p className="text-[14px] font-medium text-ink">{d.sourceFilename}</p>
                <p className="text-[12.5px] text-faint">
                  {d.itemCount} paires · modifié le {formatDate(d.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/faq-builder/${d.id}`}
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink"
                >
                  Ouvrir
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Supprimer « ${d.sourceFilename} » ?`)) {
                      del.mutate({ id: d.id })
                    }
                  }}
                  disabled={del.isPending}
                  className="rounded-lg px-2 py-1.5 text-[13px] text-red disabled:opacity-50"
                  aria-label={`Supprimer ${d.sourceFilename}`}
                >
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
