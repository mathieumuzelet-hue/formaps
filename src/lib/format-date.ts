const FR_LONG = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/**
 * Long French date, e.g. `formatDateFr('2026-06-22') → '22 juin 2026'`.
 * Accepts an ISO string or a `Date`. Returns `''` for null/undefined or an
 * unparseable value, so callers can render it inline without guards.
 */
export function formatDateFr(date: Date | string | null | undefined): string {
  if (date == null) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return FR_LONG.format(d)
}
