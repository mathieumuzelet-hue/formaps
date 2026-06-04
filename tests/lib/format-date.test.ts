import { formatDateFr } from '@/lib/format-date'
import { expect, test } from 'vitest'

test('formats an ISO string to a long French date', () => {
  expect(formatDateFr('2026-06-22T10:30:00.000Z')).toBe('22 juin 2026')
})

test('formats a Date instance to a long French date', () => {
  expect(formatDateFr(new Date('2026-06-22T10:30:00.000Z'))).toBe(
    '22 juin 2026',
  )
})

test('returns an empty string for null', () => {
  expect(formatDateFr(null)).toBe('')
})

test('returns an empty string for undefined', () => {
  expect(formatDateFr(undefined)).toBe('')
})

test('returns an empty string for an invalid date string', () => {
  expect(formatDateFr('not-a-date')).toBe('')
})
