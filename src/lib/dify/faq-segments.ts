import type { FaqItem } from '@/lib/faq/types'

/** Un segment Q&A Dify : question dans `content`, réponse dans `answer`. */
export type DifyQaSegment = { content: string; answer: string }

/** Mappe les paires FAQ d'un draft vers des segments Q&A Dify (ordre préservé). */
export function faqItemsToSegments(items: FaqItem[]): DifyQaSegment[] {
  return items.map((it) => ({ content: it.question, answer: it.answer }))
}
