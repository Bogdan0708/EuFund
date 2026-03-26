'use client'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { Icon } from '@/components/ui/ds-icon'

interface ContinueBannerProps {
  session: {
    id: string
    currentStep: number
    projectTitle?: string | null
    updatedAt: string
  }
}

export function ContinueBanner({ session }: ContinueBannerProps) {
  const locale = useLocale()
  const t = useTranslations('landing')

  const stepLabels = [
    t('steps.enhance'), t('steps.match'), t('steps.validate'),
    t('steps.research'), t('steps.knowledge'), t('steps.plan'), t('steps.build'),
  ]

  const label = session.projectTitle || `${t('step')} ${session.currentStep}/7`
  const stepLabel = stepLabels[session.currentStep - 1] || ''
  const timeAgo = getTimeAgo(session.updatedAt, locale)

  return (
    <Link href={`/${locale}/ai?session=${session.id}`}>
      <DsCard className="p-4 flex items-center gap-4 border border-primary/20 hover:shadow-lg transition-shadow cursor-pointer">
        <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center shrink-0">
          <Icon name="play_arrow" size="md" className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-on-surface font-medium truncate">
            {t('continue')}: {label}
          </p>
          <p className="text-on-surface-variant text-sm">
            {t('step')} {session.currentStep}/7 — {stepLabel}
          </p>
        </div>
        <span className="text-outline text-xs shrink-0">{timeAgo}</span>
      </DsCard>
    </Link>
  )
}

function getTimeAgo(dateStr: string, locale: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return locale === 'ro' ? 'acum' : 'just now'
  if (hours < 24) return locale === 'ro' ? `acum ${hours}h` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return locale === 'ro' ? `acum ${days}z` : `${days}d ago`
}
