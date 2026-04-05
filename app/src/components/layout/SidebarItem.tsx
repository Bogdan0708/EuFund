'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import { Icon } from '@/components/ui/ds-icon'

interface SidebarItemProps {
  href: string
  icon: string
  label: string
  active?: boolean
  collapsed?: boolean
}

export function SidebarItem({ href, icon, label, active = false, collapsed = false }: SidebarItemProps) {
  return (
    <Link
      href={href}
      className={`
        relative flex items-center gap-3 px-4 py-2 font-medium text-sm tracking-tight
        rounded-full transition-all duration-300 hover:translate-y-[-1px]
        ${active
          ? 'text-[#0071E3]'
          : 'text-black hover:text-black hover:bg-[#E3E2E7]'
        }
      `}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute inset-0 bg-[#E3E2E7] rounded-full"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <span className="relative z-10">
        <Icon name={icon} filled={active} size="md" className="shrink-0" />
      </span>
      {!collapsed && (
        <span className="relative z-10 truncate">{label}</span>
      )}
    </Link>
  )
}
