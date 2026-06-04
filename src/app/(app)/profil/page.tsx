import { auth } from '@/server/auth'
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
        Profil — bientôt. La gestion de votre compte arrivera prochainement.
      </p>
      <div className="mt-8">
        <LogoutButton />
      </div>
    </div>
  )
}
