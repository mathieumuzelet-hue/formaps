'use client'

import { useState } from 'react'

import { trpc } from '@/lib/trpc/client'

const LABEL = 'mb-1 block text-[12px] font-medium text-sub'

/** Maps cover-upload HTTP error statuses to a French message. */
function coverErrorMessage(status: number): string {
  if (status === 413) return 'Image trop lourde (max 5 Mo)'
  if (status === 415) return "Format d'image non supporté"
  return "Échec de l'envoi de l'image"
}

/**
 * Bloc « Visuel de couverture » d'une formation (admin). Calqué sur le bloc
 * cover de NewsEditor. `formations` n'a pas de colonne updatedAt : le
 * cache-bust de la preview utilise un state local (`Date.now()` posé après
 * chaque upload réussi).
 */
export function FormationCoverAdmin({ formationId }: { formationId: string }) {
  const utils = trpc.useUtils()
  const query = trpc.admin.formations.list.useQuery()
  const formation = query.data?.find((f) => f.id === formationId)

  const [coverError, setCoverError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // Bumped after a successful upload so the <img> bypasses the browser cache.
  const [version, setVersion] = useState<number | null>(null)

  async function onCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    setCoverError(null)
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/admin/formations/${formationId}/cover`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        setCoverError(coverErrorMessage(res.status))
        return
      }
      setVersion(Date.now())
      await utils.admin.formations.list.invalidate()
    } catch {
      setCoverError("Échec de l'envoi de l'image")
    } finally {
      setUploading(false)
    }
  }

  const coverSrc = formation?.coverImageUrl
    ? version
      ? `${formation.coverImageUrl}?v=${version}`
      : formation.coverImageUrl
    : null

  return (
    <section className="rounded-[14px] border border-line bg-card p-4">
      <label htmlFor="formation-cover" className={LABEL}>
        Visuel de couverture
      </label>
      {coverSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverSrc}
          alt="Couverture"
          className="mb-3 max-h-48 rounded-lg border border-line object-cover"
        />
      )}
      <input
        id="formation-cover"
        type="file"
        accept="image/*"
        disabled={uploading}
        onChange={onCoverChange}
        className="block text-[13px] text-sub file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink hover:file:bg-sand/50"
      />
      {uploading && <p className="mt-1 text-[12px] text-sub">Envoi en cours…</p>}
      {coverError && <p className="mt-1 text-[13px] text-red">{coverError}</p>}
    </section>
  )
}
