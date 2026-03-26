'use client'
import Link from 'next/link'
import { Icon } from '@/components/ui/ds-icon'

interface SidebarItemProps {
  href: string
  icon: string
  label: string
  active?: boolean
}

export function SidebarItem({ href, icon, label, active = false }: SidebarItemProps) {
  return (
    <Link
      href={href}
      className={`
        flex items-center gap-3 px-4 py-2 text-sm font-medium tracking-tight
        transition-all duration-300
        ${active
          ? 'bg-surface-container-highest text-primary-container rounded-full'
          : 'text-on-surface-variant hover:bg-surface-container-highest hover:-translate-y-[1px] rounded-full'
        }
      `}
    >
      <Icon name={icon} filled={active} size="md" className="shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  )
}
