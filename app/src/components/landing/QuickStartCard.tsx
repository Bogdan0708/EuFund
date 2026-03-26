'use client'
import Link from 'next/link'
import { DsCard } from '@/components/ui/ds-card'
import { Icon } from '@/components/ui/ds-icon'

interface QuickStartCardProps {
  href: string
  icon: string
  title: string
  description: string
  metric?: string
}

export function QuickStartCard({ href, icon, title, description, metric }: QuickStartCardProps) {
  return (
    <Link href={href}>
      <DsCard className="p-6 h-full flex flex-col gap-3 hover:shadow-lg transition-shadow cursor-pointer">
        <Icon name={icon} size="lg" className="text-primary" />
        <h3 className="text-on-surface font-semibold text-base">{title}</h3>
        <p className="text-on-surface-variant text-sm flex-1">{description}</p>
        {metric && <p className="text-outline text-xs">{metric}</p>}
      </DsCard>
    </Link>
  )
}
