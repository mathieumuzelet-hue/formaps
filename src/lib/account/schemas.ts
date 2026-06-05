import { z } from 'zod'

/**
 * Zod input schemas for the account router. Server-free module so unit tests
 * can import it without the tRPC/auth runtime (same pattern as admin schemas).
 */

/** Input schema for `account.changePassword`. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})
