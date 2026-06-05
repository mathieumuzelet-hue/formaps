import { BrainChat } from '@/components/brain/BrainChat'
import { resolveSuggestions } from '@/lib/brain/suggestions'
import { getServerCaller } from '@/server/trpc/server'

export default async function BrainPage() {
  const api = await getServerCaller()
  const rows = await api.brain.suggestions()
  return <BrainChat suggestions={resolveSuggestions(rows.map((r) => r.text))} />
}
