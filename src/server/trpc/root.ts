import { router } from './trpc'
import { storeRouter } from './routers/store'
import { formationRouter } from './routers/formation'
import { progressRouter } from './routers/progress'
import { adminRouter } from './routers/admin'
import { newsRouter } from './routers/news'

/**
 * Root tRPC router. The `admin` router (M8) is admin-only at the procedure
 * level (`adminProcedure`).
 */
export const appRouter = router({
  store: storeRouter,
  formation: formationRouter,
  progress: progressRouter,
  admin: adminRouter,
  news: newsRouter,
})

export type AppRouter = typeof appRouter
