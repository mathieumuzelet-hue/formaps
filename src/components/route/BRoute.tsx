import { STAGES } from '@/lib/design/tokens'
import { Icon } from '@/components/ui/Icon'

export type BRouteProps = {
  current?: number
  compact?: boolean
  onDark?: boolean
}

export function BRoute({ current = 1, compact, onDark = false }: BRouteProps) {
  const progressWidth = `${(current / (STAGES.length - 1)) * 84}%`
  const track = onDark ? 'bg-white/20' : 'bg-line'
  const idleCircle = onDark
    ? 'border-white/30 bg-white/[0.08]'
    : 'border-line bg-surface'
  const idleNum = onDark ? 'text-white/70' : 'text-faint'
  const labelOn = onDark ? 'text-cream' : 'text-ink'
  const labelOff = onDark ? 'text-white/60' : 'text-sub'
  return (
    <div className="relative flex items-start">
      {/* background line */}
      <div className={`absolute top-[13px] left-[8%] right-[8%] h-0.5 ${track}`} />
      {/* red progress line */}
      <div
        className="absolute top-[13px] left-[8%] h-0.5 bg-red"
        style={{ width: progressWidth }}
      />
      {STAGES.map((s, i) => {
        const done = i < current
        const on = i === current
        return (
          <div
            key={s}
            className="z-[1] flex flex-1 flex-col items-center gap-[9px]"
          >
            <div
              className={`flex items-center justify-center rounded-full border-2 transition-all duration-200 ${
                on
                  ? 'h-7 w-7 border-red bg-red'
                  : done
                    ? 'h-[22px] w-[22px] border-red bg-red'
                    : `h-[22px] w-[22px] ${idleCircle}`
              }`}
            >
              {done ? (
                <Icon name="check" size={13} color="#fff" strokeWidth={2.4} />
              ) : on ? (
                <span className="h-2 w-2 rounded-full bg-white" />
              ) : (
                <span className={`text-[11px] font-bold ${idleNum}`}>{i + 1}</span>
              )}
            </div>
            {!compact && (
              <div
                className={`text-center text-[12.5px] ${
                  on ? `font-extrabold ${labelOn}` : `font-semibold ${labelOff}`
                }`}
              >
                {s}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
