'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Icon } from '@/components/ui/Icon'

const NAV_ITEMS: ReadonlyArray<readonly [href: string, label: string, icon: string]> = [
  ['/admin/magasins', 'Magasins', 'pin'],
  ['/admin/formations', 'Formations', 'book'],
  ['/admin/actualites', 'Actualités', 'bell'],
  ['/admin/utilisateurs', 'Utilisateurs', 'user'],
  ['/admin/suggestions', 'Suggestions BRAIN', 'brain'],
  ['/admin/faq-gaps', 'Trous FAQ', 'search'],
  ['/admin/faq-builder', 'FAQ Builder', 'chat'],
  ['/admin/embed-test', "Labo d'embed", 'settings'],
]

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AdminNav() {
  const pathname = usePathname()

  return (
    <aside className="flex w-[230px] shrink-0 flex-col border-r border-line bg-surface px-4 py-6">
      <div className="mb-6 flex items-center gap-[10px] px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red">
          <Icon name="settings" size={18} color="#fff" strokeWidth={1.9} />
        </div>
        <span className="font-serif text-[19px] font-semibold tracking-[-0.01em]">
          Admin
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map(([href, label, icon]) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] ${
                active
                  ? 'bg-sand font-bold text-ink'
                  : 'font-medium text-sub hover:bg-sand/50'
              }`}
            >
              <Icon name={icon} size={18} />
              {label}
            </Link>
          )
        })}
      </nav>

      <Link
        href="/"
        className="mt-4 flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13.5px] font-medium text-sub hover:bg-sand/50"
      >
        <Icon name="chevronL" size={16} />
        Retour au cockpit
      </Link>
    </aside>
  )
}
