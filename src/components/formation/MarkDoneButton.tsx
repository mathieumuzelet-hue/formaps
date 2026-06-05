'use client'

import { useRouter } from 'next/navigation'

import { trpc } from '@/lib/trpc/client'
import { Icon } from '@/components/ui/Icon'

/**
 * Toggle de progression d'une formation pour l'utilisateur courant.
 * < 100 % : bouton « Marquer comme terminée » (progress.markDone).
 * 100 % : badge terminé + lien discret d'annulation (progress.markUndone).
 * Les données venant du RSC parent, on rafraîchit la route en succès.
 */
export function MarkDoneButton({
  formationId,
  percent,
}: {
  formationId: string
  percent: number
}) {
  const router = useRouter()
  const markDone = trpc.progress.markDone.useMutation({
    onSuccess: () => router.refresh(),
  })
  const markUndone = trpc.progress.markUndone.useMutation({
    onSuccess: () => router.refresh(),
  })
  const pending = markDone.isPending || markUndone.isPending

  if (percent >= 100) {
    return (
      <div className="mt-4 border-t border-line pt-[14px]">
        <div className="flex items-center gap-2 text-[13px] font-bold text-ink">
          <Icon name="check" size={16} color="#A20D24" />
          Formation terminée
        </div>
        <button
          type="button"
          onClick={() => markUndone.mutate({ formationId })}
          disabled={pending}
          className="mt-2 text-[12.5px] font-medium text-sub underline underline-offset-2 disabled:opacity-50"
        >
          Marquer comme non terminée
        </button>
        {markUndone.isError && (
          <p className="mt-2 text-[12.5px] text-red">{markUndone.error.message}</p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-4 border-t border-line pt-[14px]">
      <button
        type="button"
        onClick={() => markDone.mutate({ formationId })}
        disabled={pending}
        className="w-full rounded-[10px] bg-red px-4 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-50"
      >
        {pending ? 'Enregistrement…' : 'Marquer comme terminée'}
      </button>
      {markDone.isError && (
        <p className="mt-2 text-[12.5px] text-red">{markDone.error.message}</p>
      )}
    </div>
  )
}
