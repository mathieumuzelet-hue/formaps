import type { BrainMessage } from '@/lib/brain/useBrainChat'

/**
 * Groups the flat chat history into question/answer exchanges: each user
 * message opens a new exchange, and an ai message answers the pending user
 * message of the last exchange. An ai message with nothing to answer
 * (defensive) gets its own exchange. Used by BrainChat to render one
 * bordered card per exchange.
 */
export function groupExchanges(messages: BrainMessage[]): BrainMessage[][] {
  const exchanges: BrainMessage[][] = []
  for (const message of messages) {
    const last = exchanges[exchanges.length - 1]
    const answersLast = message.role === 'ai' && last?.[last.length - 1]?.role === 'user'
    if (answersLast) last.push(message)
    else exchanges.push([message])
  }
  return exchanges
}
