/**
 * Pure CSV *export* helpers for the admin bulk-import UI: template generation
 * and generated-credentials export. No browser/server APIs here — the caller
 * wraps the returned string in a Blob and triggers a download. Kept pure so the
 * header/BOM/delimiter contract is unit-testable.
 */

import { BOM, DELIMITER, csvCell } from '@/lib/csv'

// Re-export for the tests importing BOM from here.
export { BOM } from '@/lib/csv'

export type ImportKind = 'stores' | 'users'

type Template = { header: string[]; example: string[] }

const TEMPLATES: Record<ImportKind, Template> = {
  stores: {
    header: ['nom', 'date_bascule', 'etape'],
    example: ['Magasin de Lille', '2026-06-22', '1'],
  },
  users: {
    header: ['email', 'prenom', 'role', 'magasin'],
    example: ['camille.durand@apsuper.fr', 'Camille', 'employee', 'Magasin de Lille'],
  },
}

/**
 * Build the downloadable model CSV for a given import kind: a BOM, a header row
 * and exactly one example row, joined with `;`.
 */
export function buildTemplateCsv(kind: ImportKind): string {
  const { header, example } = TEMPLATES[kind]
  const lines = [header.map(csvCell).join(DELIMITER), example.map(csvCell).join(DELIMITER)]
  return BOM + lines.join('\n')
}

/**
 * Build a `email;mot_de_passe` CSV for the credentials generated during a user
 * bulk-import. Empty input yields just the BOM + header row.
 */
export function toCredentialsCsv(
  created: Array<{ email: string; password: string }>,
): string {
  const lines = ['email;mot_de_passe']
  for (const { email, password } of created) {
    lines.push(`${csvCell(email)}${DELIMITER}${csvCell(password)}`)
  }
  return BOM + lines.join('\n')
}
