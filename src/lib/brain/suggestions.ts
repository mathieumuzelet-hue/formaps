/**
 * The four suggested questions shown under the BRAIN composer.
 * Mirrors `BRAIN_SUGGEST` from the handoff design (shared.jsx).
 */
export const BRAIN_SUGGESTIONS: string[] = [
  'Comment paramétrer une caisse Mercalys ?',
  'Quelles sont les étapes de la clôture comptable ?',
  'Où trouver le planning de bascule de mon magasin ?',
  'Comment gérer un retour client après la bascule ?',
]

/**
 * Suggestions effectivement affichées : celles configurées en base si
 * présentes, sinon le fallback hardcodé — la zone n'est jamais vide.
 */
export function resolveSuggestions(fromDb: string[]): string[] {
  return fromDb.length > 0 ? fromDb : BRAIN_SUGGESTIONS
}
