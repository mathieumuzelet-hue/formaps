/**
 * Browser-only helper used by the admin CSV exports.
 *
 * Triggers a client-side download of `content` as a UTF-8 text file. Touches
 * `document` and `URL`, so it must only be called in the browser (e.g. from a
 * `'use client'` component event handler). The `appendChild` + `remove` dance
 * is required for the anchor click to work in some Firefox versions.
 */
export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
