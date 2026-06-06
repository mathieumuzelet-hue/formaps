import { eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'

import { users } from '@/server/db/schema'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { changePasswordSchema } from '@/lib/account/schemas'
import { protectedProcedure, router } from '../trpc'

/** Self-service account operations for the logged-in user. */
export const accountRouter = router({
  /**
   * Change the current user's password. Requires the current password to
   * match; the new password is stored as an argon2id hash. Never returns
   * any hash material.
   */
  changePassword: protectedProcedure
    .input(changePasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1)

      if (!row) throw new TRPCError({ code: 'UNAUTHORIZED' })

      const ok = await verifyPassword(row.passwordHash, input.currentPassword)
      if (!ok) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Mot de passe actuel incorrect',
        })
      }

      const passwordHash = await hashPassword(input.newPassword)
      await ctx.db
        .update(users)
        .set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id))

      return { ok: true }
    }),
})
