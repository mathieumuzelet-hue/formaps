'use client'

import Link from 'next/link'
import { useState } from 'react'

import { trpc } from '@/lib/trpc/client'

const INPUT =
  'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[14px] focus:border-ink focus:outline-none'
const LABEL = 'mb-1 block text-[12px] font-medium text-sub'

const UPLOAD_ERRORS: Record<string, string> = {
  file_too_large: 'Fichier trop volumineux (max 25 Mo).',
  invalid_type: 'Le fichier doit être un PDF.',
  file_required: 'Aucun fichier sélectionné.',
  invalid_form: 'Formulaire invalide.',
  forbidden: 'Accès refusé.',
  formation_not_found: 'Formation introuvable.',
}

function uploadErrorMessage(code: string | undefined, status: number): string {
  if (code && UPLOAD_ERRORS[code]) return UPLOAD_ERRORS[code]
  if (status === 413) return UPLOAD_ERRORS.file_too_large
  if (status === 415) return UPLOAD_ERRORS.invalid_type
  return `Échec de l'envoi (erreur ${status}).`
}

export function FormationDocumentsAdmin({ formationId }: { formationId: string }) {
  const utils = trpc.useUtils()
  const docs = trpc.admin.formations.documentsByFormation.useQuery({ formationId })

  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const del = trpc.admin.formations.deleteDocument.useMutation({
    onSuccess: () => utils.admin.formations.documentsByFormation.invalidate({ formationId }),
  })

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setUploadError(null)
    const form = e.currentTarget
    const data = new FormData(form)
    const file = data.get('file')
    if (!(file instanceof File) || file.size === 0) {
      setUploadError(UPLOAD_ERRORS.file_required)
      return
    }

    const body = new FormData()
    body.append('file', file)
    body.append('title', (data.get('title') as string) ?? '')
    body.append('pages', (data.get('pages') as string) ?? '0')
    body.append('isNew', data.get('isNew') === 'on' ? 'true' : 'false')

    setIsUploading(true)
    try {
      // No Content-Type header: the browser sets the multipart boundary itself.
      const res = await fetch(`/api/admin/formations/${formationId}/documents`, {
        method: 'POST',
        body,
      })
      if (!res.ok) {
        let code: string | undefined
        try {
          code = (await res.json())?.error
        } catch {
          // ignore non-JSON body
        }
        setUploadError(uploadErrorMessage(code, res.status))
        return
      }
      form.reset()
      await utils.admin.formations.documentsByFormation.invalidate({ formationId })
    } catch {
      setUploadError("Échec de l'envoi (réseau).")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div>
      <Link href="/admin/formations" className="text-[13px] font-medium text-sub hover:text-ink">
        ← Formations
      </Link>
      <h1 className="mt-2 font-serif text-[30px] font-medium tracking-[-0.02em]">Documents</h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Documents PDF rattachés à cette formation.
      </p>

      <div className="mt-6 space-y-6">
        <section className="overflow-hidden rounded-[14px] border border-line bg-card">
          {docs.isLoading && <p className="px-4 py-3 text-[14px] text-sub">Chargement…</p>}
          {docs.isError && (
            <p className="px-4 py-3 text-[14px] text-red">{docs.error.message}</p>
          )}
          {docs.data && docs.data.length === 0 && (
            <p className="px-4 py-3 text-[14px] text-sub">Aucun document.</p>
          )}
          {docs.data && docs.data.length > 0 && (
            <ul className="divide-y divide-line">
              {docs.data.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-ink">
                        {doc.order}. {doc.title}
                      </span>
                      {doc.isNew && (
                        <span className="rounded-full bg-redSoft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-red">
                          Nouveau
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-faint">
                      PDF · {doc.pages} pages · {doc.sizeLabel}
                    </p>
                  </div>
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
                  >
                    Télécharger
                  </a>
                  <button
                    type="button"
                    disabled={del.isPending}
                    onClick={() => {
                      if (window.confirm(`Supprimer « ${doc.title} » ?`)) {
                        del.mutate({ docId: doc.id })
                      }
                    }}
                    className="rounded-lg border border-redSoft px-3 py-1.5 text-[13px] font-medium text-red hover:bg-redSoft disabled:opacity-50"
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}
          {del.isError && (
            <p className="border-t border-line px-4 py-2 text-[13px] text-red">
              {del.error.message}
            </p>
          )}
        </section>

        <form onSubmit={onSubmit} className="rounded-[14px] border border-line bg-card p-5">
          <h2 className="text-[15px] font-semibold text-ink">Ajouter un document</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={LABEL}>Fichier PDF</label>
              <input type="file" name="file" accept="application/pdf" required className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Titre</label>
              <input type="text" name="title" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Nombre de pages</label>
              <input type="number" name="pages" defaultValue={0} min={0} className={INPUT} />
            </div>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" name="isNew" className="h-4 w-4" />
                Nouveau
              </label>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            {uploadError && <span className="mr-auto text-[13px] text-red">{uploadError}</span>}
            <button
              type="submit"
              disabled={isUploading}
              className="rounded-lg bg-red px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {isUploading ? 'Envoi…' : 'Ajouter le document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
