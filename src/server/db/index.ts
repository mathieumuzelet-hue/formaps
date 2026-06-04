import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

// Cache the postgres client on globalThis to avoid exhausting connections
// during Next.js dev hot-reload (each reload would otherwise open a new pool).
const globalForDb = globalThis as unknown as {
  __cockpitPgClient?: ReturnType<typeof postgres>
}

const client = globalForDb.__cockpitPgClient ?? postgres(connectionString, { max: 1 })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__cockpitPgClient = client
}

export const db = drizzle(client, { schema })

export { schema }
export * from './schema'
