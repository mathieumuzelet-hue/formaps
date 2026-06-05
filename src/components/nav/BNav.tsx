'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Icon } from '@/components/ui/Icon'
import { ApsLogo } from '@/components/ui/ApsLogo'
import { COLORS } from '@/lib/design/tokens'

const NAV_ITEMS: ReadonlyArray<readonly [href: string, label: string]> = [
  ['/', 'Accueil'],
  ['/formations', 'Formations'],
  ['/brain', 'BRAIN'],
  ['/actualites', 'Actualités'],
]

function initials(firstName: string): string {
  return firstName.slice(0, 2).toUpperCase() || '··'
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export type BNavProps = {
  firstName: string
  role: 'employee' | 'admin'
}

export function BNav({ firstName, role }: BNavProps) {
  const pathname = usePathname()

  return (
    <header className="flex items-center gap-[30px] border-b border-line bg-surface px-10 py-5">
      <Link href="/" className="flex items-center gap-[10px]">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red">
          <Icon name="compass" size={19} color="#fff" strokeWidth={1.9} />
        </div>
        <span className="font-serif text-[22px] font-semibold tracking-[-0.01em]">
          Cockpit
        </span>
      </Link>

      <nav className="ml-3 flex gap-[26px]">
        {NAV_ITEMS.map(([href, label]) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              className={`relative pb-[3px] text-[14.5px] ${
                active ? 'font-bold text-ink' : 'font-medium text-sub'
              }`}
            >
              {label}
              {active && (
                <span className="absolute -bottom-[21px] left-0 right-0 h-[2.5px] bg-red" />
              )}
            </Link>
          )
        })}
        {role === 'admin' && (
          <Link
            href="/admin/magasins"
            className={`relative pb-[3px] text-[14.5px] ${
              pathname.startsWith('/admin')
                ? 'font-bold text-ink'
                : 'font-medium text-sub'
            }`}
          >
            Admin
            {pathname.startsWith('/admin') && (
              <span className="absolute -bottom-[21px] left-0 right-0 h-[2.5px] bg-red" />
            )}
          </Link>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-[18px]">
        <Icon name="search" size={20} color={COLORS.sub} />
        <Icon name="bell" size={20} color={COLORS.sub} />
        <Link
          href="/compte/mot-de-passe"
          title="Changer mon mot de passe"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-sand text-[13px] font-bold transition-colors hover:bg-line"
        >
          {initials(firstName)}
        </Link>
        <ApsLogo height={28} />
      </div>
    </header>
  )
}
