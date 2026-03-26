'use client'
import { useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { Icon } from '@/components/ui/ds-icon'

interface ProfileCardProps {
  user: { name?: string | null; email?: string | null }
}

export function ProfileCard({ user }: ProfileCardProps) {
  const t = useTranslations('settings')
  return (
    <DsCard className="p-6">
      <div className="flex items-center gap-4 mb-4">
        <Icon name="person" size="md" className="text-primary" />
        <h2 className="text-lg font-semibold text-on-surface">{t('profile')}</h2>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-outline uppercase tracking-wider">{t('name')}</label>
          <p className="text-on-surface">{user.name || '-'}</p>
        </div>
        <div>
          <label className="text-xs text-outline uppercase tracking-wider">{t('email')}</label>
          <p className="text-on-surface">{user.email || '-'}</p>
        </div>
      </div>
    </DsCard>
  )
}
