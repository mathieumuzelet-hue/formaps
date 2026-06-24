import { redirect } from 'next/navigation'

import { auth } from '@/server/auth'
import { BrandLockup } from '@/components/ui/BrandLockup'
import { BRoute } from '@/components/route/BRoute'
import { LoginForm } from '@/components/auth/LoginForm'

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>
}) {
  // Node-side "already logged in → home" bounce. The Edge middleware can NOT
  // do this (it only sees the JWT signature, not password freshness, and
  // bouncing stale tokens home caused an infinite redirect loop — incident
  // 2026-06-06). Here auth() runs the freshness check: a genuinely valid
  // session goes home, a stale one resolves to null and gets the login form.
  const session = await auth()
  if (session?.user) {
    redirect('/')
  }

  const { changed } = await searchParams
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      {/* Gauche - panneau de marque violine (charte : logo blanc sur fond coloré) */}
      <div className="relative flex w-full flex-col overflow-hidden bg-violine px-[56px] py-[54px] text-cream md:w-[54%]">
        <div className="pointer-events-none absolute -right-[120px] -top-[100px] h-[360px] w-[360px] rounded-full bg-red/[0.16]" />
        <div className="pointer-events-none absolute -bottom-[140px] right-[30px] h-[280px] w-[280px] rounded-full bg-cream/5" />

        <BrandLockup onDark logoH={30} />

        <div className="relative mb-[42px] mt-auto">
          <div className="mb-4 text-[12.5px] font-bold uppercase tracking-[0.14em] text-cream/85">
            Auchan&nbsp;&nbsp;→&nbsp;&nbsp;Intermarché
          </div>
          <h1 className="m-0 max-w-[470px] font-sans text-[44px] font-extrabold leading-[1.08] tracking-[-0.02em]">
            Chaque étape du trajet, <span className="text-coral">accompagnée</span>.
          </h1>
          <p className="mt-[18px] max-w-[430px] text-[15px] leading-[1.6] text-cream/80">
            FormA⁺Super réunit vos formations, vos repères et l’assistant BRAIN pour
            traverser la bascule sereinement, ensemble.
          </p>
        </div>

        <div className="relative">
          <BRoute current={1} onDark />
        </div>
      </div>

      {/* Droite - colonne formulaire */}
      <div className="flex flex-1 items-center justify-center bg-bg p-10">
        <div className="w-[350px] max-w-full">
          <div className="mb-[10px] text-[11.5px] font-bold uppercase tracking-[0.12em] text-red">
            Portail formation
          </div>
          <h2 className="m-0 font-sans text-[30px] font-extrabold tracking-[-0.01em]">
            Se connecter
          </h2>
          <p className="mb-7 mt-[7px] text-[14px] text-sub">
            Avec votre identifiant salarié A⁺Super.
          </p>

          {changed === '1' && (
            <p role="status" className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink">
              Mot de passe modifié, reconnectez-vous.
            </p>
          )}

          <LoginForm />

          <p className="mt-6 text-center text-[12px] leading-[1.5] text-faint">
            Accès réservé aux salariés du groupe.
          </p>
        </div>
      </div>
    </div>
  )
}
