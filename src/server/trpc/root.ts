import { router } from './trpc'
import { storeRouter } from './routers/store'
import { formationRouter } from './routers/formation'
import { progressRouter } from './routers/progress'

/**
 * Root tRPC router. Admin + BRAIN routers join in later milestones (M7/M8) —
 * add them as additional keys here when they land.
 */
export const appRouter = router({
  store: storeRouter,
  formation: formationRouter,
  progress: progressRouter,
})

export type AppRouter = typeof appRouter
