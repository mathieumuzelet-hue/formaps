import { BrainChat } from '@/components/brain/BrainChat'
import { resolveSuggestions } from '@/lib/brain/suggestions'
import { getServerCaller } from '@/server/trpc/server'

export default async function BrainPage() {
  const api = await getServerCaller()
  // The fallback suggestions exist precisely for when the DB has none —
  // a failing query must not 500 the whole chat page.
  const rows = await api.brain.suggestions().catch(() => [])
  return <BrainChat suggestions={resolveSuggestions(rows.map((r) => r.text))} />
}
