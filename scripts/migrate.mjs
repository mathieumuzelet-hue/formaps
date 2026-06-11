import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[migrate] DATABASE_URL manquant')
  process.exit(1)
}

const RETRIES = Number(process.env.MIGRATE_RETRIES || 5)
const DELAY_MS = Number(process.env.MIGRATE_RETRY_DELAY_MS || 3000)
// Clé arbitraire constante du projet : sérialise les migrations entre containers.
const LOCK_KEY = 727274440

const sql = postgres(url, { max: 1 })

// La DB peut mettre quelques secondes à accepter les connexions après un
// restart (`depends_on` ne couvre que le premier start, pas les restarts de
// `restart: unless-stopped`) — retry avant d'abandonner, pour casser le
// crash-loop boot ↔ DB pas prête.
let ready = false
for (let attempt = 1; attempt <= RETRIES; attempt++) {
  try {
    await sql`SELECT 1`
    ready = true
    break
  } catch (err) {
    console.error(`[migrate] DB injoignable (tentative ${attempt}/${RETRIES}) : ${err.message}`)
    if (attempt < RETRIES) await new Promise((r) => setTimeout(r, DELAY_MS))
  }
}
if (!ready) {
  console.error(`[migrate] abandon après ${RETRIES} tentatives`)
  await sql.end()
  process.exit(1)
}

// Lock de session : deux containers qui bootent en même temps sérialisent
// leurs migrations (le second attend, puis trouve tout déjà appliqué). En cas
// de crash, le lock meurt avec la connexion — pas de lock orphelin.
await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
try {
  const db = drizzle(sql)
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('[migrate] migrations appliquées')
} catch (err) {
  console.error('[migrate] échec des migrations :', err)
  process.exit(1) // le lock de session est libéré par la mort de la connexion
}
await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`
await sql.end()
