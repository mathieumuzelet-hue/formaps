import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TRPCError } from '@trpc/server'

import { getServerCaller } from '@/server/trpc/server'
import { Icon } from '@/components/ui/Icon'
import { ImgSlot } from '@/components/ui/ImgSlot'
import { RefreshOnFocus } from '@/components/formation/RefreshOnFocus'

export default async function FormationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const api = await getServerCaller()

  let data
  try {
    data = await api.formation.bySlug({ slug })
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'NOT_FOUND') {
      notFound()
    }
    throw err
  }

  const { formation, documents, related } = data
  const summary = await api.progress.mine()
  const percent = summary.percentByFormation[formation.id] ?? 0

  return (
    <div className="grid grid-cols-1 gap-[34px] px-5 py-[26px] md:px-10 lg:grid-cols-[1.7fr_1fr]">
      {/* Met à jour la barre de progression au retour de l'onglet PDF. */}
      <RefreshOnFocus />
      {/* Left column */}
      <div>
        {/* Breadcrumb */}
        <div className="mb-4 flex w-fit items-center gap-[7px] text-[13px] text-sub">
          <Icon name="chevronL" size={15} color="#8A7F6E" />
          <Link href="/formations" className="font-semibold">
            Espace Formation
          </Link>
          <span className="text-faint">/</span>
          <span className="font-bold text-ink">{formation.name}</span>
        </div>

        <div className="mb-2 text-[12.5px] font-bold uppercase tracking-[0.05em] text-red">
          {formation.tag.toUpperCase()}
        </div>
        <h1 className="font-serif text-[28px] font-medium leading-[1.05] tracking-[-0.02em] md:text-[40px]">
          {formation.name}
        </h1>
        <p className="my-[14px] mb-[18px] max-w-[560px] font-serif text-[17.5px] leading-[1.55] text-sub">
          {formation.description}
        </p>

        {/* Meta row */}
        <div className="flex gap-[18px] border-b border-line pb-5 text-[13px] text-sub">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="file" size={15} color="#8A7F6E" /> {documents.length}{' '}
            documents
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="clock" size={15} color="#8A7F6E" /> ~45 min
          </span>
          <span>Mis à jour récemment</span>
        </div>

        {/* Documents list / empty state */}
        {documents.length === 0 ? (
          <div className="mt-[22px] rounded-[14px] border border-line bg-surface px-6 py-7">
            <p className="text-[14.5px] leading-[1.5] text-sub">
              Les documents de cette formation seront bientôt disponibles.
            </p>
            {formation.sharepointUrl && (
              <a
                href={formation.sharepointUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-[13.5px] font-bold text-redink"
              >
                <Icon name="external" size={16} color="#A20D24" /> Ouvrir sur
                SharePoint
              </a>
            )}
          </div>
        ) : (
          <div className="mt-[22px]">
            {documents.map((d, i) => (
              <div
                key={d.id}
                className="flex items-center gap-4 border-b border-line px-0.5 py-[15px]"
              >
                <span className="w-8 font-serif text-[24px] font-medium text-faint">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-[9px]">
                    <span className="font-serif text-[17px] font-medium">
                      {d.title}
                    </span>
                    {d.isNew && (
                      <span className="rounded-[20px] border border-red px-[7px] py-px text-[10px] font-extrabold text-red">
                        NOUVEAU
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-faint">
                    PDF · {d.pages} pages · {d.sizeLabel}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-[18px]">
                  <a
                    href={d.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-[13.5px] font-bold text-redink"
                  >
                    <Icon name="eye" size={17} color="#A20D24" /> Consulter
                  </a>
                  <a
                    href={`${d.fileUrl}?download=1`}
                    className="inline-flex items-center gap-2 text-[13.5px] font-bold text-sub"
                  >
                    <Icon name="download" size={17} color="#8A7F6E" /> Télécharger
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-[18px]">
        <ImgSlot
          label={'visuel de couverture\n(photo caisse / capture)'}
          height={170}
          radius={16}
          tone="#EFE6D6"
          accent="#D6C9B2"
        />

        {/* Progression card */}
        <div className="rounded-[16px] border border-line bg-surface px-5 py-[18px]">
          <div className="mb-1.5 text-[13px] font-bold text-sub">PROGRESSION</div>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[32px] font-medium">{percent}%</span>
            <span className="text-[13px] text-sub">du parcours</span>
          </div>
          <div className="mt-[10px] h-[6px] rounded-[3px] bg-line">
            <div
              className="h-full rounded-[3px] bg-red"
              style={{ width: `${percent}%` }}
            />
          </div>
          {formation.sharepointUrl && (
            <a
              href={formation.sharepointUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center gap-[9px] border-t border-line pt-[14px] text-[13px] font-bold text-sub"
            >
              <Icon name="external" size={16} color="#8A7F6E" /> Ouvrir sur
              SharePoint
            </a>
          )}
          {percent >= 100 ? (
            <div className="mt-4 flex items-center gap-2 border-t border-line pt-[14px] text-[13px] font-bold text-ink">
              <Icon name="check" size={16} color="#A20D24" />
              Formation terminée
            </div>
          ) : (
            <p className="mt-4 border-t border-line pt-[14px] text-[12.5px] leading-[1.5] text-sub">
              La progression avance automatiquement quand vous consultez les
              documents.
            </p>
          )}
        </div>

        {/* Related */}
        {related.length > 0 && (
          <div className="rounded-[16px] border border-line bg-surface px-5 py-[18px]">
            <div className="mb-[10px] font-serif text-[18px] font-medium">
              Pour aller plus loin
            </div>
            {related.map((t, i) => (
              <Link
                key={t.id}
                href={`/formations/${t.slug}`}
                className={`flex items-center gap-[11px] py-[9px] ${
                  i ? 'border-t border-line' : ''
                }`}
              >
                <Icon name={t.icon} size={20} color="#A20D24" />
                <span className="flex-1 text-[13.5px] font-semibold">
                  {t.name}
                </span>
                <Icon name="arrowR" size={16} color="#B7AD9A" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
