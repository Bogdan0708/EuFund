'use client'
import { useTranslations } from 'next-intl'
import { GlassCard, GlassButton } from '@/components/glass'
import { Shield } from 'lucide-react'

export function PrivacyCard() {
  const t = useTranslations('settings')

  const handleExportData = () => {
    fetch('/api/v1/user/export')
      .then(r => r.blob())
      .then(b => {
        const url = URL.createObjectURL(b)
        const a = document.createElement('a')
        a.href = url
        a.download = 'my-data.json'
        a.click()
      })
      .catch(() => {})
  }

  return (
    <GlassCard hover={false} className="p-6">
      <div className="flex items-center gap-4 mb-4">
        <Shield size={20} className="text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('privacy')}</h2>
      </div>
      <div className="space-y-3">
        <GlassButton variant="ghost" onClick={() => { window.location.href = '/api/auth/consent' }}>
          {t('manageConsent')}
        </GlassButton>
        <GlassButton variant="ghost" onClick={handleExportData}>
          {t('exportData')}
        </GlassButton>
        <GlassButton variant="danger">
          {t('deleteAccount')}
        </GlassButton>
      </div>
    </GlassCard>
  )
}
