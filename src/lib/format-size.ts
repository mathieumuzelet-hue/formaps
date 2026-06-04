/**
 * Human-readable file size in French notation (comma decimal separator).
 *
 * - `< 1024` bytes        → "N o"          (no decimals)
 * - `< 1024²` bytes       → "X,Y Ko"       (one decimal)
 * - otherwise             → "X,Y Mo"       (one decimal)
 */
export function formatFileSize(bytes: number): string {
  const KB = 1024
  const MB = KB * 1024

  if (bytes < KB) {
    return `${bytes} o`
  }
  if (bytes < MB) {
    return `${(bytes / KB).toFixed(1).replace('.', ',')} Ko`
  }
  return `${(bytes / MB).toFixed(1).replace('.', ',')} Mo`
}
