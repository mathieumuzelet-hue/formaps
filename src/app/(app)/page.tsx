import Link from 'next/link'

import { auth } from '@/server/auth'
import { getServerCaller } from '@/server/trpc/server'
import { joursLabel, plusQuePrefix } from '@/lib/home-format'
import { BRoute } from '@/components/route/BRoute'
import { Icon } from '@/components/ui/Icon'

export default async function HomePage() {
  const session = await auth()
  const firstName = session?.user?.firstName ?? ''

  const api = await getServerCaller()
  const [store, formations, summary] = await Promise.all([
    api.store.getMine(),
    api.formation.list(),
    api.progress.mine(),
  ])

  // Graceful state for a user without a store rattaché.
  if (!store) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-24 text-center md:px-10">
        <div className="mb-4 text-[13px] font-bold uppercase tracking-[0.04em] text-red">
          Votre trajet
        </div>
        <h1 className="font-serif text-[27px] font-medium leading-[1.05] tracking-[-0.02em] md:text-[38px]">
          Bonjour {firstName}.
        </h1>
        <p className="mt-4 max-w-[440px] text-[15.5px] leading-[1.6] text-sub">
          Aucun magasin rattaché à votre compte. Contactez votre référent pour
          rejoindre le trajet de votre magasin.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[22px] px-5 py-[30px] md:px-10">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-5">
        <div>
          <div className="mb-1.5 text-[13px] font-bold uppercase tracking-[0.04em] text-red">
            Votre trajet · Magasin de {store.name.toUpperCase()}
          </div>
          <h1 className="font-serif text-[27px] font-medium leading-[1.05] tracking-[-0.02em] md:text-[38px]">
            Bonjour {firstName}, {plusQuePrefix(store.joursRestants)}
            <span className="text-red">{joursLabel(store.joursRestants)}</span>.
          </h1>
        </div>
        <div className="md:ml-auto md:text-right">
          <div className="text-[13px] text-sub">Étape en cours</div>
          <div className="text-[17px] font-extrabold">
            {store.currentStep + 1} · {store.currentStepLabel}
          </div>
        </div>
      </div>

      {/* Route card */}
      <div className="rounded-[18px] border border-line bg-surface px-5 pb-6 pt-[26px] md:px-10">
        <div className="md:hidden">
          <BRoute current={store.currentStep} compact />
        </div>
        <div className="hidden md:block">
          <BRoute current={store.currentStep} />
        </div>
      </div>

      {/* Access cards */}
      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
        <Link
          href="/formations"
          className="relative overflow-hidden rounded-[18px] border border-line bg-card px-[26px] py-6 text-ink"
        >
          <div className="mb-4 flex h-[50px] w-[50px] items-center justify-center rounded-full bg-redsoft">
            <Icon name="book" size={26} color="#A20D24" strokeWidth={1.8} />
          </div>
          <div className="mb-[7px] font-serif text-[23px] font-medium">
            Espace Formation
          </div>
          <p className="mb-[18px] max-w-[380px] text-[14px] leading-[1.55] text-sub">
            Reprenez là où vous en étiez — {summary.done} formations sur{' '}
            {summary.total} terminées.
          </p>
          <div className="inline-flex items-center gap-2 text-[14px] font-bold text-redink">
            Continuer le parcours{' '}
            <Icon name="arrowR" size={17} color="#A20D24" />
          </div>
        </Link>

        <Link
          href="/brain"
          className="relative overflow-hidden rounded-[18px] border border-ink bg-ink px-[26px] py-6 text-white"
        >
          <div className="mb-4 flex h-[50px] w-[50px] items-center justify-center rounded-full bg-white/[0.12]">
            <Icon name="brain" size={26} color="#fff" strokeWidth={1.8} />
          </div>
          <div className="mb-[7px] font-serif text-[23px] font-medium">
            Assistant BRAIN
          </div>
          <p className="mb-[18px] max-w-[380px] text-[14px] leading-[1.55] text-white/[0.78]">
            Une question sur la bascule ? BRAIN répond, sources à l’appui.
          </p>
          <div className="inline-flex items-center gap-2 text-[14px] font-bold text-white">
            Poser une question <Icon name="arrowR" size={17} color="#fff" />
          </div>
        </Link>
      </div>

      {/* "À reprendre" strip */}
      <div>
        <div className="mb-3 flex items-baseline">
          <div className="font-serif text-[19px] font-medium">À reprendre</div>
          <Link
            href="/formations"
            className="ml-auto text-[13px] font-bold text-redink"
          >
            Tout l’espace formation →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-3">
          {formations.slice(0, 3).map((f) => {
            const percent = summary.percentByFormation[f.id] ?? 0
            return (
              <Link
                key={f.id}
                href={`/formations/${f.slug}`}
                className="flex items-center gap-[13px] rounded-[14px] border border-line bg-card px-[18px] py-4"
              >
                <div className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[10px] bg-redsoft">
                  <Icon name={f.icon} size={22} color="#A20D24" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-bold">{f.name}</div>
                  <div className="mt-[7px] h-[5px] rounded-[3px] bg-line">
                    <div
                      className="h-full rounded-[3px] bg-red"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
