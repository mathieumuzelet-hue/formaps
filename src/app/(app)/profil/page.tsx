import Link from 'next/link'

import { auth } from '@/server/auth'
import { Icon } from '@/components/ui/Icon'
import { LogoutButton } from '@/components/nav/LogoutButton'

export default async function ProfilPage() {
  const session = await auth()
  const firstName = session?.user?.firstName ?? ''

  return (
    <div className="px-5 py-7 md:px-10">
      <div className="mb-4 text-[13px] font-bold uppercase tracking-[0.04em] text-red">
        Profil
      </div>
      <h1 className="font-serif text-[28px] font-medium leading-[1.05] tracking-[-0.02em] md:text-[40px]">
        Bonjour {firstName}.
      </h1>
      <p className="mt-4 max-w-[420px] text-[15.5px] leading-[1.6] text-sub">
        Gérez votre compte Cockpit.
      </p>
      <div className="mt-8 flex flex-col items-start gap-4">
        <Link
          href="/compte/mot-de-passe"
          className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-card px-[18px] py-[13px] text-[14px] font-bold text-ink"
        >
          <Icon name="settings" size={18} color="#8A7F6E" />
          Changer mon mot de passe
        </Link>
        <LogoutButton />
      </div>
    </div>
  )
}
