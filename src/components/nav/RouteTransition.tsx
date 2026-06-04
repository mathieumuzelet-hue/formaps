'use client'

import { usePathname } from 'next/navigation'

export type RouteTransitionProps = {
  children: React.ReactNode
}

/**
 * Lightweight screen transition: keying on the pathname forces a remount on
 * navigation, replaying the `route-fade` keyframe (fade + translateY 6px → 0).
 */
export function RouteTransition({ children }: RouteTransitionProps) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="route-transition">
      {children}
    </div>
  )
}
