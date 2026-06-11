/**
 * Limiteur de tentatives de connexion EN MÉMOIRE (anti credential-stuffing).
 *
 * Hypothèse assumée : l'app tourne en mono-container (Dokploy) — pas de Redis.
 * Limitation documentée : le compteur se réinitialise au redéploiement, ce qui
 * est acceptable pour ralentir une attaque online (argon2id protège le reste).
 *
 * Clé = `ip|email normalisé`. Au-delà de LOGIN_MAX_FAILURES échecs dans la
 * fenêtre glissante, `authorize` rejette sans toucher ni la DB ni argon2.
 */

export const LOGIN_MAX_FAILURES = 5
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
/** Au-delà de cette taille, recordLoginFailure balaie les entrées expirées. */
const SWEEP_THRESHOLD = 1000

const failures = new Map<string, number[]>()

export function loginRateLimitKey(ip: string, normalizedEmail: string): string {
  return `${ip}|${normalizedEmail}`
}

/** Timestamps encore dans la fenêtre ; nettoie l'entrée au passage. */
function liveTimestamps(key: string, now: number): number[] {
  const stamps = failures.get(key)
  if (!stamps) return []
  const live = stamps.filter((t) => now - t < LOGIN_WINDOW_MS)
  if (live.length === 0) failures.delete(key)
  else if (live.length !== stamps.length) failures.set(key, live)
  return live
}

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  return liveTimestamps(key, now).length >= LOGIN_MAX_FAILURES
}

export function recordLoginFailure(key: string, now: number = Date.now()): void {
  if (failures.size >= SWEEP_THRESHOLD) {
    for (const k of [...failures.keys()]) liveTimestamps(k, now)
  }
  // Cap : seuls les LOGIN_MAX_FAILURES plus récents comptent (mémoire bornée même si l'appelant record en étant déjà limité).
  failures.set(key, [...liveTimestamps(key, now), now].slice(-LOGIN_MAX_FAILURES))
}

/** À appeler sur login réussi. */
export function clearLoginFailures(key: string): void {
  failures.delete(key)
}

/** Réservé aux tests. */
export function resetLoginRateLimiter(): void {
  failures.clear()
}
