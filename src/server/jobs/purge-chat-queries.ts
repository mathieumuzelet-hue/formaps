// src/server/jobs/purge-chat-queries.ts
import { lt } from 'drizzle-orm'

import type { db } from '@/server/db'
import { chatQueries } from '@/server/db/schema'

/**
 * Purge RGPD automatisée de `chat_queries` (questions BRAIN = texte libre
 * potentiellement personnel — voir docs/DEPLOY.md). Lancée au boot par
 * src/instrumentation.ts puis toutes les 24 h. Rétention par défaut 12 mois,
 * configurable via CHAT_QUERIES_RETENTION_MONTHS (mappée dans le compose).
 */

type Db = typeof db

export const DEFAULT_RETENTION_MONTHS = 12
export const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000

export function retentionMonths(
  raw: string | undefined = process.env.CHAT_QUERIES_RETENTION_MONTHS,
): number {
  if (!raw) return DEFAULT_RETENTION_MONTHS
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    console.warn(
      `[rgpd] CHAT_QUERIES_RETENTION_MONTHS invalide (« ${raw} ») — défaut ${DEFAULT_RETENTION_MONTHS} mois`,
    )
    return DEFAULT_RETENTION_MONTHS
  }
  return n
}

export function retentionCutoff(months: number, now: Date = new Date()): Date {
  const cutoff = new Date(now)
  // setMonth peut déborder en fin de mois (ex. 31 mars − 1 mois → 3 mars) :
  // sur-suppression bornée à ≤ 3 jours, soit le sens CONFORME pour une
  // rétention « 12 mois maximum ». Ne pas « corriger » dans l'autre sens.
  cutoff.setMonth(cutoff.getMonth() - months)
  return cutoff
}

/** Supprime les requêtes plus vieilles que la rétention ; retourne le nombre. */
export async function purgeChatQueries(
  dbClient: Db,
  months: number = retentionMonths(),
): Promise<number> {
  const deleted = await dbClient
    .delete(chatQueries)
    .where(lt(chatQueries.createdAt, retentionCutoff(months)))
    .returning({ id: chatQueries.id })
  return deleted.length
}

let started = false

/** Boot + toutes les 24 h. Idempotent ; les erreurs DB sont loggées, jamais levées. */
export function startChatQueriesPurgeJob(dbClient: Db): void {
  if (started) return
  started = true
  const run = async () => {
    try {
      const months = retentionMonths()
      const n = await purgeChatQueries(dbClient, months)
      console.log(`[rgpd] purge chat_queries : ${n} ligne(s) supprimée(s) (rétention ${months} mois)`)
    } catch (err) {
      console.error('[rgpd] purge chat_queries échouée (retentée au prochain cycle) :', err)
    }
  }
  void run()
  // unref(): le timer ne retient pas le process à l'arrêt (SIGTERM propre).
  setInterval(run, PURGE_INTERVAL_MS).unref()
}
