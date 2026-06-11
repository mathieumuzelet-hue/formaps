// src/instrumentation.ts
/**
 * Next.js instrumentation hook — runs ONCE at server start (Node runtime
 * only; never during build, never on Edge). Dynamic imports keep the db
 * driver out of any non-Node bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const [{ db }, { startChatQueriesPurgeJob }] = await Promise.all([
    import('@/server/db'),
    import('@/server/jobs/purge-chat-queries'),
  ])
  startChatQueriesPurgeJob(db)
}
