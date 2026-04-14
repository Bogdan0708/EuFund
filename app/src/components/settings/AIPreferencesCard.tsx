'use client'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { GlassCard, GlassButton } from '@/components/glass'
import { Sparkles } from 'lucide-react'

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
    <GlassCard hover={false} className="p-6">
      <div className="flex items-center gap-4 mb-4">
        <Sparkles size={20} className="text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('aiPreferences')}</h2>
      </div>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">{t('model')}</label>
          <select
            value={prefs.defaultModel}
            onChange={e => setPrefs(p => ({ ...p, defaultModel: e.target.value }))}
            className="w-full mt-1 bg-[var(--bg-glass)] border border-[var(--border-subtle)] rounded-[var(--input-radius)] text-[var(--text-primary)] px-3 py-2"
          >
            <option value="auto">Auto</option>
            <option value="claude-sonnet">Claude Sonnet</option>
            <option value="gemini-pro">Gemini Pro</option>
            <option value="gpt-4o">GPT-4o</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">{t('responseStyle')}</label>
          <select
            value={prefs.responseStyle}
            onChange={e => setPrefs(p => ({ ...p, responseStyle: e.target.value }))}
            className="w-full mt-1 bg-[var(--bg-glass)] border border-[var(--border-subtle)] rounded-[var(--input-radius)] text-[var(--text-primary)] px-3 py-2"
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
          <label className="text-sm text-[var(--text-secondary)]">{t('autoApprove')}</label>
        </div>
        <GlassButton onClick={save} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </GlassButton>
      </div>
    </GlassCard>
  )
}
