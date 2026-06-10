import { z } from 'zod'

/**
 * One FAQ pair inside a draft. Shared client/server: the editor manipulates
 * these, `faq_drafts.items` (jsonb) stores the ordered array, and the tRPC
 * `updateItems` input validates against it.
 */
export const faqItemSchema = z.object({
  id: z.uuid(),
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(8000),
  origin: z.enum(['generated', 'manual']),
})

export type FaqItem = z.infer<typeof faqItemSchema>
