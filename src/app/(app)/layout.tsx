import { redirect } from 'next/navigation'

import { auth } from '@/server/auth'
import { BNav } from '@/components/nav/BNav'
import { RouteTransition } from '@/components/nav/RouteTransition'

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth()

  // Middleware already guards this group, but never render the shell without
  // a session (defence in depth + narrows the type for `firstName`).
  if (!session?.user) {
    redirect('/connexion')
  }

  return (
    <>
      <BNav firstName={session.user.firstName} />
      <main className="flex-1">
        <RouteTransition>{children}</RouteTransition>
      </main>
    </>
  )
}
