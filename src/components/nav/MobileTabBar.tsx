'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Icon } from '@/components/ui/Icon'
import { COLORS } from '@/lib/design/tokens'

const TABS: ReadonlyArray<readonly [href: string, icon: string, label: string]> =
  [
    ['/', 'home', 'Accueil'],
    ['/formations', 'book', 'Former'],
    ['/brain', 'brain', 'BRAIN'],
    ['/actualites', 'news', 'Actus'],
    ['/profil', 'user', 'Profil'],
  ]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function MobileTabBar() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex border-t border-line bg-surface pb-[calc(14px+env(safe-area-inset-bottom))] pt-[10px] md:hidden"
      aria-label="Navigation principale"
    >
      {TABS.map(([href, icon, label]) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-1 ${
              active ? 'font-bold text-red' : 'font-semibold text-faint'
            }`}
          >
            <Icon
              name={icon}
              size={21}
              color={active ? COLORS.red : COLORS.faint}
              strokeWidth={active ? 2 : 1.7}
            />
            <span className="text-[10.5px]">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
