'use client'
import { GlassInput, GlassChip } from '@/components/glass'
import { useTranslations } from 'next-intl'

interface CallFiltersProps {
  search: string
  onSearchChange: (v: string) => void
  status: string
  onStatusChange: (v: string) => void
}

const STATUSES = ['all', 'deschis', 'previzionat', 'inchis'] as const

export function CallFilters({ search, onSearchChange, status, onStatusChange }: CallFiltersProps) {
  const t = useTranslations('calls')
  return (
    <div className="flex flex-col md:flex-row gap-3">
      <GlassInput
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        placeholder={t('searchPlaceholder')}
        className="md:max-w-sm"
      />
      <div className="flex gap-2 flex-wrap">
        {STATUSES.map(s => (
          <GlassChip key={s} active={status === s} onClick={() => onStatusChange(s)}>
            {t(`status.${s}`)}
          </GlassChip>
        ))}
      </div>
    </div>
  )
}
