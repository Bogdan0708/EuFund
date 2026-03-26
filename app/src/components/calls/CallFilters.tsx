'use client'
import { DsInput } from '@/components/ui/ds-input'
import { DsChip } from '@/components/ui/ds-chip'
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
      <DsInput
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        placeholder={t('searchPlaceholder')}
        className="md:max-w-sm"
      />
      <div className="flex gap-2 flex-wrap">
        {STATUSES.map(s => (
          <DsChip key={s} variant={status === s ? 'selected' : 'default'} onClick={() => onStatusChange(s)}>
            {t(`status.${s}`)}
          </DsChip>
        ))}
      </div>
    </div>
  )
}
