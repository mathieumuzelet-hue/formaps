import { eq } from 'drizzle-orm'

import { stores } from '@/server/db/schema'
import { toStoreView, type StoreView } from '@/lib/store-view'
import { protectedProcedure, router } from '../trpc'

export const storeRouter = router({
  /**
   * The current user's store, mapped to the home-screen view. Returns `null`
   * when the user is not attached to a store.
   */
  getMine: protectedProcedure.query(async ({ ctx }): Promise<StoreView | null> => {
    if (!ctx.user.storeId) return null

    const [store] = await ctx.db
      .select()
      .from(stores)
      .where(eq(stores.id, ctx.user.storeId))
      .limit(1)

    if (!store) return null

    return toStoreView(store)
  }),
})
