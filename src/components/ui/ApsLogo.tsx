import Image from 'next/image'

const INTRINSIC_W = 467
const INTRINSIC_H = 147
const RATIO = INTRINSIC_W / INTRINSIC_H

export type ApsLogoProps = {
  height?: number
  className?: string
}

export function ApsLogo({ height = 28, className }: ApsLogoProps) {
  const width = Math.round(height * RATIO)
  return (
    <Image
      src="/logo-aps.png"
      alt="A+SUPER"
      height={height}
      width={width}
      className={className}
      style={{ height, width: 'auto', display: 'block', flexShrink: 0 }}
    />
  )
}
