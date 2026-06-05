'use client'

import { useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { trpc } from '@/lib/trpc/client'

type Feedback = 'like' | 'dislike'

/**
 * Discreet 👍/👎 under a finished BRAIN answer. Optimistic local state (kept
 * for the session only — not re-hydrated on reload); clicking the other
 * button overwrites the previous feedback.
 */
export function FeedbackButtons({ messageId }: { messageId: string }) {
  const [selected, setSelected] = useState<Feedback | null>(null)
  const feedback = trpc.brain.feedback.useMutation()

  const send = (value: Feedback) => {
    if (feedback.isPending || selected === value) return
    setSelected(value)
    feedback.mutate({ messageId, feedback: value })
  }

  const btn = (value: Feedback, icon: string, label: string) => {
    const active = selected === value
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={() => send(value)}
        className={`rounded-md p-1.5 transition-colors ${
          active ? 'text-red' : 'text-faint hover:text-sub'
        }`}
      >
        <Icon name={icon} size={15} />
      </button>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-1">
      {btn('like', 'thumbsUp', 'Réponse utile')}
      {btn('dislike', 'thumbsDown', 'Réponse inutile')}
    </div>
  )
}
