'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/ds-icon'

interface MobileNavProps {
  locale: string
}

const NAV_ITEMS = [
  { route: '/panou', icon: 'home', label: 'Acasa' },
  { route: '/proiecte', icon: 'folder_open', label: 'Proiecte' },
  { route: '/finantari', icon: 'euro_symbol', label: 'Finantari' },
  { route: '/asistent-ai', icon: 'smart_toy', label: 'AI' },
  { route: '/documente', icon: 'description', label: 'Documente' },
] as const

export function MobileNav({ locale }: MobileNavProps) {
  const pathname = usePathname()
  const prefix = `/${locale}`

  const isActive = (route: string) => {
    const href = `${prefix}${route}`
    if (route === '/panou') {
      return pathname === prefix || pathname === `${prefix}/` || pathname === href
    }
    return pathname.startsWith(href)
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-background border-t border-outline-variant/20">
      <div className="flex items-center justify-around py-2 px-1">
        {NAV_ITEMS.map((item) => {
          const href = `${prefix}${item.route}`
          const active = isActive(item.route)
          return (
            <Link
              key={item.route}
              href={href}
              className={`
                flex flex-col items-center justify-center gap-0.5
                min-w-[48px] py-1 rounded-xl
                transition-colors duration-200
                ${active
                  ? 'text-primary-container'
                  : 'text-on-surface-variant hover:text-on-surface'
                }
              `}
            >
              <Icon name={item.icon} filled={active} size="md" />
              <span className="text-[10px] font-medium leading-tight">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
