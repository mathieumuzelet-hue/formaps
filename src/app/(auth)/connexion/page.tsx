import { Icon } from '@/components/ui/Icon'
import { ApsLogo } from '@/components/ui/ApsLogo'
import { BRoute } from '@/components/route/BRoute'
import { LoginForm } from '@/components/auth/LoginForm'

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>
}) {
  const { changed } = await searchParams
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      {/* Left — brand panel */}
      <div className="flex w-full flex-col border-line bg-surface px-[56px] py-[54px] md:w-[54%] md:border-r">
        <div className="flex items-center gap-[11px]">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red">
            <Icon name="compass" size={21} color="#fff" strokeWidth={1.9} />
          </div>
          <span className="font-serif text-[25px] font-semibold">Cockpit</span>
        </div>

        <div className="mb-10 mt-auto">
          <div className="mb-[14px] text-[13px] font-bold uppercase tracking-[0.04em] text-red">
            Auchan → Intermarché
          </div>
          <h1 className="m-0 max-w-[460px] font-serif text-[46px] font-medium leading-[1.08] tracking-[-0.02em]">
            Chaque étape du trajet, accompagnée.
          </h1>
          <p className="mt-[18px] max-w-[420px] text-[15.5px] leading-[1.6] text-sub">
            Cockpit réunit vos formations, vos repères et l’assistant BRAIN pour
            traverser la bascule sereinement, ensemble.
          </p>
        </div>

        <BRoute current={1} />
      </div>

      {/* Right — form column */}
      <div className="flex flex-1 items-center justify-center bg-bg p-10">
        <div className="w-[350px] max-w-full">
          <div className="mb-[34px] flex justify-end">
            <ApsLogo height={30} />
          </div>
          <h2 className="m-0 font-serif text-[30px] font-medium">Se connecter</h2>
          <p className="mb-7 mt-[6px] text-[14px] text-sub">
            Avec votre identifiant salarié.
          </p>

          {changed === '1' && (
            <p className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink">
              Mot de passe modifié, reconnectez-vous.
            </p>
          )}

          <LoginForm />

          <p className="mt-6 text-center text-[12.5px] leading-[1.5] text-faint">
            Accès réservé aux salariés du groupe.
          </p>
        </div>
      </div>
    </div>
  )
}
