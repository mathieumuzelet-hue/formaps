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
