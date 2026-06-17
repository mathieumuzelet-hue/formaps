import { describe, expect, test } from 'vitest'
import { faqItemsToSegments } from '@/lib/dify/faq-segments'
import type { FaqItem } from '@/lib/faq/types'

const item = (q: string, a: string): FaqItem => ({
  id: '00000000-0000-0000-0000-000000000001',
  question: q,
  answer: a,
  origin: 'generated',
})

describe('faqItemsToSegments', () => {
  test('maps question→content and answer→answer', () => {
    expect(faqItemsToSegments([item('Q1 ?', 'R1.')])).toEqual([
      { content: 'Q1 ?', answer: 'R1.' },
    ])
  })
  test('preserves order and count', () => {
    const out = faqItemsToSegments([item('a', '1'), item('b', '2')])
    expect(out.map((s) => s.content)).toEqual(['a', 'b'])
  })
})
