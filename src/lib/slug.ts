/**
 * Build a URL-safe slug from an arbitrary label.
 *
 * - lowercases
 * - strips diacritics (NFD decomposition, then drops combining marks)
 * - collapses any run of non-alphanumeric characters into a single `-`
 * - trims leading/trailing `-`
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
