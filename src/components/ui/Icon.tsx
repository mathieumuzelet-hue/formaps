import {
  Compass,
  Brain,
  ArrowRight,
  Download,
  ExternalLink,
  FileText,
  Send,
  BookOpen,
  MessageSquare,
  ShoppingCart,
  Package,
  Euro,
  Layers,
  User,
  Truck,
  Headset,
  Shield,
  Clock,
  Bell,
  Search,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Lock,
  Play,
  Sparkles,
  Settings,
  LogOut,
  MapPin,
  Flag,
  LayoutGrid,
  Home,
  Newspaper,
  Quote,
  ThumbsUp,
  ThumbsDown,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  compass: Compass,
  brain: Brain,
  arrowR: ArrowRight,
  download: Download,
  external: ExternalLink,
  file: FileText,
  send: Send,
  book: BookOpen,
  chat: MessageSquare,
  cart: ShoppingCart,
  box: Package,
  euro: Euro,
  layers: Layers,
  user: User,
  truck: Truck,
  headset: Headset,
  shield: Shield,
  clock: Clock,
  bell: Bell,
  search: Search,
  check: Check,
  checkCircle: CheckCircle2,
  chevronR: ChevronRight,
  chevronD: ChevronDown,
  chevronL: ChevronLeft,
  lock: Lock,
  play: Play,
  sparkle: Sparkles,
  settings: Settings,
  logout: LogOut,
  pin: MapPin,
  flag: Flag,
  grid: LayoutGrid,
  home: Home,
  news: Newspaper,
  quote: Quote,
  thumbsUp: ThumbsUp,
  thumbsDown: ThumbsDown,
}

export type IconProps = {
  name: string
  size?: number
  color?: string
  strokeWidth?: number
  className?: string
}

export function Icon({
  name,
  size = 22,
  color = 'currentColor',
  strokeWidth = 1.7,
  className,
}: IconProps) {
  const LucideComp = ICONS[name]
  if (!LucideComp) return null
  return (
    <LucideComp
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
    />
  )
}
