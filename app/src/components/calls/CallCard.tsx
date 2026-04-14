'use client'
import { useLocale, useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { StatusBadge } from '@/components/ui/status-badge'
import { Icon } from '@/components/ui/ds-icon'

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

  return (
    <DsCard className="p-5 flex flex-col gap-3 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-primary font-mono">{call.callCode}</span>
        <StatusBadge kind="call" value={call.lastVerifiedAt ? 'open' : 'closed'} />
      </div>
      <h3 className="text-on-surface font-semibold text-base line-clamp-2">{title}</h3>
      {call.submissionEnd && (
        <div className="flex items-center gap-1.5 text-outline text-xs">
          <Icon name="calendar_today" size="sm" />
          <span>{t('deadline')}: {new Date(call.submissionEnd).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-US')}</span>
        </div>
      )}
      {call.officialUrl && (
        <a
          href={call.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-primary hover:underline mt-auto"
        >
          <Icon name="open_in_new" size="sm" />{t('viewOfficial')}
        </a>
      )}
    </DsCard>
  )
}
