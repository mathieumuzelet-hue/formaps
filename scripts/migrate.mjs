import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL manquant')
  process.exit(1)
}

const sql = postgres(url, { max: 1 })
const db = drizzle(sql)
await migrate(db, { migrationsFolder: './drizzle' })
await sql.end()
console.log('migrations appliquées')
