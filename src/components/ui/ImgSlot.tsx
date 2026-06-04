export type ImgSlotProps = {
  label?: string
  width?: number | string
  height?: number | string
  radius?: number
  accent?: string
  tone?: string
  className?: string
}

export function ImgSlot({
  label = 'image',
  width = '100%',
  height = 160,
  radius = 12,
  accent = '#c9bfb2',
  tone = '#efe9e0',
  className,
}: ImgSlotProps) {
  const stripe = `repeating-linear-gradient(135deg, ${tone}, ${tone} 11px, ${accent}22 11px, ${accent}22 22px)`
  const lines = String(label).split(/\\n|\n/)
  return (
    <div
      className={className}
      style={{
        width,
        height,
        borderRadius: radius,
        background: stripe,
        border: `1px solid ${accent}55`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(60,52,44,.55)',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 12,
        letterSpacing: '.04em',
        textAlign: 'center',
        lineHeight: 1.5,
        padding: 8,
        boxSizing: 'border-box',
      }}
    >
      <div>
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}
