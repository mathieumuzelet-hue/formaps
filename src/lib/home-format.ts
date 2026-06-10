/**
 * Human-readable countdown label for the Home header.
 * `joursLabel(18) → '18 jours'`, `joursLabel(1) → '1 jour'`,
 * `joursLabel(0) → "aujourd'hui"`. Non-positive values mean the bascule is
 * today (or already passed), surfaced gracefully as "aujourd'hui".
 */
export function joursLabel(n: number): string {
  if (n <= 0) return "aujourd'hui"
  return n === 1 ? '1 jour' : `${n} jours`
}

/**
 * Prefix for the countdown sentence, with French elision:
 * `plus que 18 jours` but `plus qu'aujourd'hui` (no space after the
 * apostrophe). Pairs with `joursLabel`.
 */
export function plusQuePrefix(n: number): string {
  return n <= 0 ? "plus qu'" : 'plus que '
}
