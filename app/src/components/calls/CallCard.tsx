'use client'
import { useLocale, useTranslations } from 'next-intl'
import { GlassCard, GlassBadge } from '@/components/glass'
import { Calendar, ExternalLink } from 'lucide-react'

interface CallCardProps {
  call: {
    id: string
    callCode: string
    titleRo: string
    titleEn?: string | null
    status: string
    submissionEnd?: string | null
    officialUrl?: string | null
    lastVerifiedAt?: string | null
  }
}

export function CallCard({ call }: CallCardProps) {
  const locale = useLocale()
  const t = useTranslations('calls')
  const title = locale === 'en' && call.titleEn ? call.titleEn : call.titleRo

  const trustVariant = call.lastVerifiedAt ? 'success' : 'default'
  const trustLabel = call.lastVerifiedAt ? t('verified') : t('unverified')

  return (
    <GlassCard className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-[var(--accent)] font-mono">{call.callCode}</span>
        <GlassBadge variant={trustVariant}>{trustLabel}</GlassBadge>
      </div>
      <h3 className="text-[var(--text-primary)] font-semibold text-base line-clamp-2">{title}</h3>
      {call.submissionEnd && (
        <div className="flex items-center gap-1.5 text-[var(--text-tertiary)] text-xs">
          <Calendar size={14} />
          <span>{t('deadline')}: {new Date(call.submissionEnd).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-US')}</span>
        </div>
      )}
      {call.officialUrl && (
        <a
          href={call.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline mt-auto"
        >
          <ExternalLink size={12} />{t('viewOfficial')}
        </a>
      )}
    </GlassCard>
  )
}
