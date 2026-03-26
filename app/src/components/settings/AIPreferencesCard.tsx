'use client'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { DsCard } from '@/components/ui/ds-card'
import { DsButton } from '@/components/ui/ds-button'
import { Icon } from '@/components/ui/ds-icon'

interface Preferences {
  defaultModel: string
  responseStyle: string
  autoApprove: boolean
}

export function AIPreferencesCard() {
  const t = useTranslations('settings')
  const [prefs, setPrefs] = useState<Preferences>({
    defaultModel: 'auto',
    responseStyle: 'detailed',
    autoApprove: false,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/v1/user/preferences')
      .then(r => r.json())
      .then(setPrefs)
      .catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    await fetch('/api/v1/user/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }).catch(() => {})
    setSaving(false)
  }

  return (
    <DsCard className="p-6">
      <div className="flex items-center gap-4 mb-4">
        <Icon name="auto_awesome" size="md" className="text-primary" />
        <h2 className="text-lg font-semibold text-on-surface">{t('aiPreferences')}</h2>
      </div>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-outline uppercase tracking-wider">{t('model')}</label>
          <select
            value={prefs.defaultModel}
            onChange={e => setPrefs(p => ({ ...p, defaultModel: e.target.value }))}
            className="w-full mt-1 bg-surface-container-high/50 border-none rounded-xl text-on-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="auto">Auto</option>
            <option value="claude-sonnet">Claude Sonnet</option>
            <option value="gemini-pro">Gemini Pro</option>
            <option value="gpt-4o">GPT-4o</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-outline uppercase tracking-wider">{t('responseStyle')}</label>
          <select
            value={prefs.responseStyle}
            onChange={e => setPrefs(p => ({ ...p, responseStyle: e.target.value }))}
            className="w-full mt-1 bg-surface-container-high/50 border-none rounded-xl text-on-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="concise">{t('styleConcise')}</option>
            <option value="detailed">{t('styleDetailed')}</option>
            <option value="technical">{t('styleTechnical')}</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={prefs.autoApprove}
            onChange={e => setPrefs(p => ({ ...p, autoApprove: e.target.checked }))}
            className="h-4 w-4 rounded"
          />
          <label className="text-sm text-on-surface-variant">{t('autoApprove')}</label>
        </div>
        <DsButton variant="primary" size="sm" onClick={save} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </DsButton>
      </div>
    </DsCard>
  )
}
