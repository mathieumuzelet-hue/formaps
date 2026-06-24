import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'

import authConfig from './server/auth.config'
import { decideAccess, type Role } from './lib/access'

// Build an edge-safe Auth.js instance from the config that has NO providers,
// NO db, NO argon2. This only reads/decodes the JWT session cookie.
const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const role = (req.auth?.user?.role ?? null) as Role | null
  const path = req.nextUrl.pathname

  const decision = decideAccess({ path, isLoggedIn, role })

  if (decision === 'redirect-login') {
    return NextResponse.redirect(new URL('/connexion', req.nextUrl))
  }
  if (decision === 'redirect-home') {
    return NextResponse.redirect(new URL('/', req.nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  // Run on everything except API routes, Next internals, and public assets.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|webp|gif|ico)).*)',
  ],
}
