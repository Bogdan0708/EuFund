'use client'
import Link from 'next/link'
import { type LucideIcon } from 'lucide-react'
import { GlassCard } from '@/components/glass'

interface QuickStartCardProps {
  href: string
  icon: LucideIcon
  title: string
  description: string
  metric?: string
}

export function QuickStartCard({ href, icon: Icon, title, description, metric }: QuickStartCardProps) {
  return (
    <Link href={href}>
      <GlassCard className="p-6 h-full flex flex-col gap-3">
        <Icon size={24} className="text-[var(--accent)]" />
        <h3 className="text-[var(--text-primary)] font-semibold text-base">{title}</h3>
        <p className="text-[var(--text-secondary)] text-sm flex-1">{description}</p>
        {metric && <p className="text-[var(--text-tertiary)] text-xs">{metric}</p>}
      </GlassCard>
    </Link>
  )
}
