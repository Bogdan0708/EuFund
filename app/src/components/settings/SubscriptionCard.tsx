'use client'
import { useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { DsButton } from '@/components/ui/ds-button'
import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/ui/ds-icon'
import { cn } from '@/lib/utils'

interface SubscriptionCardProps {
  tier: string
}

const tierTone: Record<string, string> = {
  enterprise: 'bg-sky-100 text-sky-700 border-sky-200',
  pro: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  free: 'bg-slate-100 text-slate-700 border-slate-200',
}

export function SubscriptionCard({ tier }: SubscriptionCardProps) {
  const t = useTranslations('settings')

  return (
    <DsCard className="p-6">
      <div className="flex items-center gap-4 mb-4">
        <Icon name="credit_card" size="md" className="text-primary" />
        <h2 className="text-lg font-semibold text-on-surface">{t('subscription')}</h2>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-on-surface-variant">{t('currentPlan')}:</span>
        <Badge variant="outline" className={cn('font-medium', tierTone[tier] || tierTone.free)}>
          {tier.toUpperCase()}
        </Badge>
      </div>
      {tier === 'free' && (
        <DsButton variant="primary" size="sm" onClick={() => { window.location.href = '/api/billing/checkout' }}>
          {t('upgrade')}
        </DsButton>
      )}
    </DsCard>
  )
}
