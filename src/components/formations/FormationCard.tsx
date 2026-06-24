import Link from 'next/link'

import { Icon } from '@/components/ui/Icon'
import { COLORS } from '@/lib/design/tokens'

export type FormationCardData = {
  id: string
  slug: string
  name: string
  icon: string
  description: string
  kind: 'sharepoint' | 'pdf'
  sharepointUrl: string | null
}

export type FormationCardProps = {
  formation: FormationCardData
  /** Zero-based position, rendered as a serif index ("01", "02", …). */
  index: number
}

const cardClass =
  'relative flex flex-col gap-3 rounded-[14px] border border-line bg-card p-[18px]'

function CardInner({ formation, index }: FormationCardProps) {
  const isPdf = formation.kind === 'pdf'
  return (
    <>
      <div className="absolute right-4 top-[14px] font-serif text-[26px] font-medium text-line">
        {String(index + 1).padStart(2, '0')}
      </div>
      <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-redsoft">
        <Icon name={formation.icon} size={23} color={COLORS.red} strokeWidth={1.8} />
      </div>
      <div>
        <div className="font-serif text-[18px] font-bold">{formation.name}</div>
        <div className="mt-[3px] text-[12.5px] leading-[1.4] text-sub">
          {formation.description}
        </div>
      </div>
      <div
        className={`mt-auto flex items-center gap-[7px] border-t border-line pt-[10px] text-[12.5px] font-bold ${
          isPdf ? 'text-redink' : 'text-sub'
        }`}
      >
        <Icon
          name={isPdf ? 'download' : 'external'}
          size={16}
          color={isPdf ? COLORS.red : COLORS.sub}
        />
        {isPdf ? 'Télécharger le PDF' : 'Ouvrir dans SharePoint'}
      </div>
    </>
  )
}

export function FormationCard({ formation, index }: FormationCardProps) {
  // SharePoint cards open the external space directly; fall back to the detail
  // page when no URL is configured.
  if (formation.kind === 'sharepoint' && formation.sharepointUrl) {
    return (
      <a
        href={formation.sharepointUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cardClass}
      >
        <CardInner formation={formation} index={index} />
      </a>
    )
  }

  return (
    <Link href={`/formations/${formation.slug}`} className={cardClass}>
      <CardInner formation={formation} index={index} />
    </Link>
  )
}
