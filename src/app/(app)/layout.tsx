import { redirect } from 'next/navigation'

import { auth } from '@/server/auth'
import { BNav } from '@/components/nav/BNav'
import { MobileBrandBar } from '@/components/nav/MobileBrandBar'
import { MobileTabBar } from '@/components/nav/MobileTabBar'
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
      <div className="hidden md:block">
        <BNav firstName={session.user.firstName} role={session.user.role} />
      </div>
      <MobileBrandBar />
      <main className="flex-1 pb-24 md:pb-0">
        <RouteTransition>{children}</RouteTransition>
      </main>
      <MobileTabBar />
    </>
  )
}
