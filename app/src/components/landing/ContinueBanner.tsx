'use client'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { GlassCard } from '@/components/glass'
import { Play } from 'lucide-react'

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
      <GlassCard accent className="p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
          <Play size={18} className="text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] font-medium truncate">
            {t('continue')}: {label}
          </p>
          <p className="text-[var(--text-secondary)] text-sm">
            {t('step')} {session.currentStep}/7 — {stepLabel}
          </p>
        </div>
        <span className="text-[var(--text-tertiary)] text-xs shrink-0">{timeAgo}</span>
      </GlassCard>
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
