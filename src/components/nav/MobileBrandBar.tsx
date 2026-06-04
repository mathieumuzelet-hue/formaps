import { Icon } from '@/components/ui/Icon'
import { COLORS } from '@/lib/design/tokens'

export function MobileBrandBar() {
  return (
    <header className="flex items-center gap-[9px] border-b border-line bg-surface px-[18px] py-4 md:hidden">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red">
        <Icon name="compass" size={17} color="#fff" />
      </div>
      <span className="font-serif text-[19px] font-semibold">Cockpit</span>
      <Icon name="bell" size={20} color={COLORS.sub} className="ml-auto" />
    </header>
  )
}
