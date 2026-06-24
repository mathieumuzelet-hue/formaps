import { Icon } from '@/components/ui/Icon'
import { BrandLockup } from '@/components/ui/BrandLockup'
import { COLORS } from '@/lib/design/tokens'

export function MobileBrandBar() {
  return (
    <header className="flex items-center gap-[9px] border-b border-line bg-surface px-[18px] py-4 md:hidden">
      <BrandLockup logoH={22} />
      <Icon name="bell" size={20} color={COLORS.sub} className="ml-auto" />
    </header>
  )
}
