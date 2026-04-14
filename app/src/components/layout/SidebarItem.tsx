'use client'
import Link from 'next/link'
import { type LucideIcon } from 'lucide-react'

interface SidebarItemProps {
  href: string
  icon: LucideIcon
  label: string
  active?: boolean
  collapsed?: boolean
}

export function SidebarItem({ href, icon: Icon, label, active = false, collapsed = false }: SidebarItemProps) {
  return (
    <Link
      href={href}
      className={`
        flex items-center gap-3 px-3 py-2 rounded-[var(--btn-radius)]
        text-[15px] transition-all duration-[var(--transition-fast)]
        ${active
          ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-l-2 border-[var(--accent)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
        }
      `}
      title={collapsed ? label : undefined}
    >
      <Icon size={20} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )
}
