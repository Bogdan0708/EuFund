'use client'
import { useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { DsButton } from '@/components/ui/ds-button'
import { Icon } from '@/components/ui/ds-icon'

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
    <DsCard className="p-6">
      <div className="flex items-center gap-4 mb-4">
        <Icon name="shield" size="md" className="text-primary" />
        <h2 className="text-lg font-semibold text-on-surface">{t('privacy')}</h2>
      </div>
      <div className="space-y-3">
        <DsButton variant="ghost" size="sm" onClick={() => { window.location.href = '/api/auth/consent' }}>
          {t('manageConsent')}
        </DsButton>
        <DsButton variant="ghost" size="sm" onClick={handleExportData}>
          {t('exportData')}
        </DsButton>
        <DsButton variant="secondary" size="sm" className="text-error">
          {t('deleteAccount')}
        </DsButton>
      </div>
    </DsCard>
  )
}
