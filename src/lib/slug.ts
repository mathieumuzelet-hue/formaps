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

/**
 * Decide which slug to display in a create form that auto-fills from the name.
 *
 * - while the user has NOT manually edited the slug (`slugTouched === false`),
 *   the slug tracks `slugify(name)`.
 * - once the user has touched the slug field, their value (`currentSlug`) wins
 *   and is returned verbatim.
 */
export function nextSlug(name: string, slugTouched: boolean, currentSlug: string): string {
  return slugTouched ? currentSlug : slugify(name)
}
