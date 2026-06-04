// Bootstrap d'un compte admin au démarrage, piloté par variables d'environnement.
// Idempotent : crée l'admin s'il n'existe pas, sinon met à jour son mot de passe + rôle.
// L'admin n'est rattaché à AUCUN magasin (store_id reste NULL).
// Si BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD ne sont pas fournis, on ne fait rien.
import postgres from 'postgres'
import argon2 from 'argon2'

const url = process.env.DATABASE_URL
const email = process.env.BOOTSTRAP_ADMIN_EMAIL
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
const firstName = process.env.BOOTSTRAP_ADMIN_FIRSTNAME || 'Admin'

if (!email || !password) {
  console.log('bootstrap admin: BOOTSTRAP_ADMIN_EMAIL/PASSWORD absents → skip')
  process.exit(0)
}
if (!url) {
  console.error('bootstrap admin: DATABASE_URL manquant')
  process.exit(1)
}

const sql = postgres(url, { max: 1 })
try {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
  // store_id volontairement omis → NULL : l'admin n'est rattaché à aucun magasin.
  // ON CONFLICT (email) : met à jour le hash + le rôle, sans toucher store_id.
  await sql`
    insert into users (email, password_hash, first_name, role)
    values (${email}, ${passwordHash}, ${firstName}, 'admin')
    on conflict (email) do update
      set password_hash = excluded.password_hash,
          role = 'admin',
          updated_at = now()
  `
  console.log(`bootstrap admin: compte « ${email} » prêt (rôle admin, sans magasin)`)
} catch (err) {
  console.error('bootstrap admin: échec', err)
  process.exit(1)
} finally {
  await sql.end()
}
