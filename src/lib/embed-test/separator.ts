/**
 * Conversions séparateur entre la forme échappée que propose Claude ("\\n\\n")
 * et les caractères réels. Module sans dépendance pour être importable depuis
 * types.ts ET chunker.ts sans cycle.
 */

/** Claude proposes separators as escaped strings ("\\n\\n") - unescape them. */
export function normalizeSeparator(separator: string): string {
  return separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

/**
 * Display inverse of `normalizeSeparator`: real newline/tab characters → their
 * escaped two-char forms, so separators render on one line in the recommendation
 * card and the results table. Idempotent: an already-escaped "\\n" holds no REAL
 * newline character, so it passes through unchanged.
 */
export function escapeSeparator(s: string): string {
  return s.replace(/\n/g, '\\n').replace(/\t/g, '\\t')
}
