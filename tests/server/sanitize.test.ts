// @vitest-environment node
import { expect, test } from 'vitest'

import { sanitizeNewsHtml } from '@/server/news/sanitize'

test('strips <script> tags', () => {
  const out = sanitizeNewsHtml('<p>hi</p><script>alert(1)</script>')
  expect(out).not.toContain('<script')
  expect(out).not.toContain('alert(1)')
})

test('strips onclick / event-handler attributes', () => {
  const out = sanitizeNewsHtml('<p onclick="evil()">x</p>')
  expect(out).not.toContain('onclick')
  expect(out).toContain('<p>x</p>')
})

test('keeps benign <p><strong> markup', () => {
  const out = sanitizeNewsHtml('<p><strong>bold</strong> text</p>')
  expect(out).toBe('<p><strong>bold</strong> text</p>')
})

test('removes javascript: href on links', () => {
  const out = sanitizeNewsHtml('<a href="javascript:alert(1)">click</a>')
  expect(out).not.toContain('javascript:')
})

test('forces target=_blank and rel on external links', () => {
  const out = sanitizeNewsHtml('<a href="https://example.com">x</a>')
  expect(out).toContain('target="_blank"')
  expect(out).toContain('rel="noopener noreferrer nofollow"')
})

test('keeps img with same-origin /api src', () => {
  const out = sanitizeNewsHtml('<img src="/api/news/abc/cover" alt="cover">')
  expect(out).toContain('<img')
  expect(out).toContain('/api/news/abc/cover')
})
