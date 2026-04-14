'use client'
import { useTranslations } from 'next-intl'
import { GlassCard, GlassBadge, GlassButton } from '@/components/glass'
import { CreditCard } from 'lucide-react'

interface SubscriptionCardProps {
  tier: string
}

export function SubscriptionCard({ tier }: SubscriptionCardProps) {
  const t = useTranslations('settings')
  const variant = tier === 'enterprise' ? 'accent' : tier === 'pro' ? 'success' : 'default'

  return (
    <GlassCard hover={false} className="p-6">
      <div className="flex items-center gap-4 mb-4">
        <CreditCard size={20} className="text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('subscription')}</h2>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[var(--text-secondary)]">{t('currentPlan')}:</span>
        <GlassBadge variant={variant}>{tier.toUpperCase()}</GlassBadge>
      </div>
      {tier === 'free' && (
        <GlassButton onClick={() => { window.location.href = '/api/billing/checkout' }}>
          {t('upgrade')}
        </GlassButton>
      )}
    </GlassCard>
  )
}
