import { headers } from 'next/headers'

import { appRouter } from './root'
import { createCallerFactory, createTRPCContext } from './trpc'

const createCaller = createCallerFactory(appRouter)

/**
 * Server-side tRPC caller for React Server Components. Builds the context from
 * the ambient request headers and invokes procedures directly (no HTTP hop).
 */
export async function getServerCaller() {
  const ctx = await createTRPCContext({ headers: await headers() })
  return createCaller(ctx)
}
