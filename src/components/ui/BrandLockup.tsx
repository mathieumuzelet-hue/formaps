import Image from 'next/image'

const INTRINSIC_W = 467
const INTRINSIC_H = 147
const RATIO = INTRINSIC_W / INTRINSIC_H

export type BrandLockupProps = {
  onDark?: boolean
  logoH?: number
}

export function BrandLockup({ onDark = false, logoH = 28 }: BrandLockupProps) {
  const width = Math.round(logoH * RATIO)
  return (
    <div className="flex items-center gap-3">
      <Image
        src={onDark ? '/logo-aps-white.png' : '/logo-aps.png'}
        alt="A+Super"
        height={logoH}
        width={width}
        style={{ height: logoH, width: 'auto', display: 'block' }}
        priority
      />
      <span
        aria-hidden="true"
        className={onDark ? 'bg-white/30' : 'bg-line'}
        style={{ width: 1, height: logoH * 0.82 }}
      />
      <span
        className={`font-sans font-bold uppercase tracking-[0.16em] ${onDark ? 'text-cream' : 'text-violine'}`}
        style={{ fontSize: logoH * 0.42 }}
      >
        Formation
      </span>
    </div>
  )
}
