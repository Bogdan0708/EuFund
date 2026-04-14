'use client'
import { useTranslations } from 'next-intl'
import { GlassCard } from '@/components/glass'
import { User } from 'lucide-react'

interface ProfileCardProps {
  user: { name?: string | null; email?: string | null }
}

export function ProfileCard({ user }: ProfileCardProps) {
  const t = useTranslations('settings')
  return (
    <GlassCard hover={false} className="p-6">
      <div className="flex items-center gap-4 mb-4">
        <User size={20} className="text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('profile')}</h2>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">{t('name')}</label>
          <p className="text-[var(--text-primary)]">{user.name || '-'}</p>
        </div>
        <div>
          <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">{t('email')}</label>
          <p className="text-[var(--text-primary)]">{user.email || '-'}</p>
        </div>
      </div>
    </GlassCard>
  )
}
