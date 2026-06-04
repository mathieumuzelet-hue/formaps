import type { DefaultSession } from 'next-auth'

type Role = 'employee' | 'admin'

declare module 'next-auth' {
  /**
   * The shape returned by the Credentials `authorize` callback and carried
   * through to the `jwt` callback as `user`.
   */
  interface User {
    role: Role
    storeId: string | null
    firstName: string
  }

  /** The session object exposed to server components and middleware. */
  interface Session {
    user: {
      id: string
      role: Role
      storeId: string | null
      firstName: string
    } & DefaultSession['user']
  }
}

// The JWT type consumed by the callbacks resolves to `@auth/core/jwt`
// (next-auth/jwt merely re-exports it), so the augmentation must target the
// original module for interface merging to take effect.
declare module '@auth/core/jwt' {
  interface JWT {
    role: Role
    storeId: string | null
    firstName: string
  }
}
