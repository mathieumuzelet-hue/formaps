import { getServerCaller } from '@/server/trpc/server'
import { FormationCard } from '@/components/formations/FormationCard'

export default async function FormationsPage() {
  const api = await getServerCaller()
  const formations = await api.formation.list()

  return (
    <div className="px-5 py-7 md:px-10">
      <div className="mb-[22px] max-w-[620px]">
        <h1 className="font-serif text-[34px] font-extrabold tracking-[-0.02em]">
          Espace Formation
        </h1>
        <p className="mt-2 text-[14.5px] leading-[1.5] text-sub">
          Les contenus pour maîtriser les nouveaux outils. Dans un premier temps
          les fiches renvoient vers SharePoint ; les pages dédiées de
          téléchargement PDF arrivent ensuite.
        </p>
      </div>
      {formations.length === 0 ? (
        <div className="rounded-[14px] border border-line bg-surface px-6 py-7">
          <p className="text-[14.5px] leading-[1.5] text-sub">
            Aucune formation disponible pour le moment — les contenus arrivent
            bientôt.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {formations.map((formation, i) => (
            <FormationCard key={formation.id} formation={formation} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
