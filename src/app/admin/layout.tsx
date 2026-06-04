import { redirect } from 'next/navigation'

import { auth } from '@/server/auth'
import { AdminNav } from '@/components/admin/AdminNav'

/**
 * Admin shell. Middleware already redirects employees away from `/admin/*`,
 * but we re-check the role server-side here (defence in depth) and never render
 * the chrome without an admin session. `/admin` is outside the `(app)` group,
 * so it has its own navigation and no BNav.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth()

  if (!session?.user || session.user.role !== 'admin') {
    redirect('/')
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <AdminNav />
      <main className="flex-1 px-8 py-8 md:px-12">{children}</main>
    </div>
  )
}
