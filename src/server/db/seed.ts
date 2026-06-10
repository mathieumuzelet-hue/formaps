import 'dotenv/config'
import argon2 from 'argon2'
import { db } from './index'
import {
  stores,
  users,
  formations,
  formationDocuments,
  userDocumentViews,
} from './schema'

function addDays(base: Date, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

/**
 * Fail-closed guard: this seed performs destructive deletes and creates a
 * default admin. It must NEVER run against a production database by accident.
 * Refuse unless the DB clearly looks like a dev/test target, or the operator
 * explicitly opts in with ALLOW_DESTRUCTIVE_SEED=yes-i-am-sure.
 */
function assertSafeToSeed() {
  const url = process.env.DATABASE_URL ?? ''
  const override = process.env.ALLOW_DESTRUCTIVE_SEED === 'yes-i-am-sure'
  const looksDev = /localhost|127\.0\.0\.1|::1|\bdev\b|\btest\b/i.test(url)
  if (process.env.NODE_ENV === 'production' && !override) {
    throw new Error('Refus du seed : NODE_ENV=production (poser ALLOW_DESTRUCTIVE_SEED=yes-i-am-sure pour forcer).')
  }
  if (!looksDev && !override) {
    throw new Error(
      "Refus du seed : DATABASE_URL ne ressemble pas à une base dev/test. " +
        'Poser ALLOW_DESTRUCTIVE_SEED=yes-i-am-sure pour forcer.',
    )
  }
}

async function main() {
  assertSafeToSeed()

  // Mots de passe de seed : surchargeable par env, fallback dev uniquement.
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234'
  const camillePassword = process.env.SEED_CAMILLE_PASSWORD ?? 'camille1234'

  // Idempotent: clear in FK-safe order, then re-insert.
  await db.delete(userDocumentViews)
  await db.delete(formationDocuments)
  await db.delete(users)
  await db.delete(formations)
  await db.delete(stores)

  // 1 store
  const [store] = await db
    .insert(stores)
    .values({
      name: 'Magasin de Lille',
      basculeDate: addDays(new Date(), 18),
      currentStep: 1,
    })
    .returning()

  // 8 formations
  const formationData = [
    {
      slug: 'mercalys',
      name: 'Mercalys',
      tag: 'Outils',
      icon: 'box',
      description: 'Gestion des prix & étiquettes',
      kind: 'sharepoint' as const,
      docCount: 8,
      sharepointUrl: 'https://sharepoint.example/mercalys',
    },
    {
      slug: 'encaissement',
      name: 'Encaissement',
      tag: 'Caisse',
      icon: 'cart',
      description: 'Caisse, scan & moyens de paiement',
      kind: 'pdf' as const,
      docCount: 12,
      sharepointUrl: null,
    },
    {
      slug: 'comptabilite',
      name: 'Comptabilité',
      tag: 'Gestion',
      icon: 'euro',
      description: 'Clôtures, écritures & flux',
      kind: 'sharepoint' as const,
      docCount: 6,
      sharepointUrl: 'https://sharepoint.example/comptabilite',
    },
    {
      slug: 'stocks',
      name: 'Gestion des stocks',
      tag: 'Logistique',
      icon: 'layers',
      description: 'Réception, inventaire & commandes',
      kind: 'pdf' as const,
      docCount: 9,
      sharepointUrl: null,
    },
    {
      slug: 'rh',
      name: 'RH & Paie',
      tag: 'RH',
      icon: 'user',
      description: 'Contrats, planning & bulletins',
      kind: 'sharepoint' as const,
      docCount: 7,
      sharepointUrl: 'https://sharepoint.example/rh',
    },
    {
      slug: 'drive',
      name: 'Drive & E-commerce',
      tag: 'Service',
      icon: 'truck',
      description: 'Préparation & retrait des commandes',
      kind: 'sharepoint' as const,
      docCount: 5,
      sharepointUrl: 'https://sharepoint.example/drive',
    },
    {
      slug: 'relation-client',
      name: 'Relation client',
      tag: 'Service',
      icon: 'headset',
      description: 'Accueil, SAV & fidélité',
      kind: 'pdf' as const,
      docCount: 4,
      sharepointUrl: null,
    },
    {
      slug: 'securite',
      name: 'Sécurité & Hygiène',
      tag: 'Magasin',
      icon: 'shield',
      description: 'Normes, contrôles & procédures',
      kind: 'sharepoint' as const,
      docCount: 6,
      sharepointUrl: 'https://sharepoint.example/securite',
    },
  ]

  const insertedFormations = await db
    .insert(formations)
    .values(formationData.map((f, index) => ({ ...f, order: index })))
    .returning()

  // 2 users (argon2id hashed passwords)
  const adminHash = await argon2.hash(adminPassword, { type: argon2.argon2id })
  const camilleHash = await argon2.hash(camillePassword, { type: argon2.argon2id })

  const insertedUsers = await db
    .insert(users)
    .values([
      {
        email: 'admin@aps.fr',
        passwordHash: adminHash,
        firstName: 'Admin',
        role: 'admin',
        storeId: store.id,
      },
      {
        email: 'camille@aps.fr',
        passwordHash: camilleHash,
        firstName: 'Camille',
        role: 'employee',
        storeId: store.id,
      },
    ])
    .returning()

  // La progression est désormais automatique (vues de documents) : le seed ne
  // crée ni document ni vue — tout le monde démarre à 0 %.
  console.log('✅ seed ok')
  console.log(
    `   stores: 1 · formations: ${insertedFormations.length} · users: ${insertedUsers.length}`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ seed failed', err)
  process.exit(1)
})
