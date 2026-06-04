import { STAGES } from '@/lib/design/tokens'
import { Icon } from '@/components/ui/Icon'

export type BRouteProps = {
  current?: number
  compact?: boolean
}

export function BRoute({ current = 1, compact }: BRouteProps) {
  const progressWidth = `${(current / (STAGES.length - 1)) * 84}%`
  return (
    <div className="relative flex items-start">
      {/* background line */}
      <div className="absolute top-[13px] left-[8%] right-[8%] h-0.5 bg-line" />
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
                    : 'h-[22px] w-[22px] border-line bg-surface'
              }`}
            >
              {done ? (
                <Icon name="check" size={13} color="#fff" strokeWidth={2.4} />
              ) : on ? (
                <span className="h-2 w-2 rounded-full bg-white" />
              ) : (
                <span className="text-[11px] font-bold text-faint">{i + 1}</span>
              )}
            </div>
            {!compact && (
              <div
                className={`text-center text-[12.5px] ${
                  on ? 'font-extrabold text-ink' : 'font-semibold text-sub'
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
