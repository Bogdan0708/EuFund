'use client'

import { useTranslations } from 'next-intl'
import type { AgentSectionState } from '@/hooks/useAgent'

interface Props {
  sections: AgentSectionState[]
  eligibility: unknown
  onComplete: () => void
  disabled?: boolean
}

export function ValidationSummary({ sections, eligibility, onComplete, disabled = false }: Props) {
  const t = useTranslations('agent')
  const accepted = sections.filter(s => s.status === 'accepted').length
  const total = sections.length
  const allAccepted = accepted === total && total > 0
  const elig = eligibility as { failCount?: number } | null
  const hasBlockers = (elig?.failCount || 0) > 0

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <h3 className="text-sm font-medium text-gray-900 mb-2">{t('applicationStatus')}</h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">{t('sectionsLabel')}</span>
          <span className={allAccepted ? 'text-green-600 font-medium' : 'text-amber-600'}>
            {t('sectionsCount', { accepted, total })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">{t('eligibility')}</span>
          <span className={hasBlockers ? 'text-red-600' : 'text-green-600'}>
            {hasBlockers ? t('eligibilityHasBlockers') : t('eligibilityPassed')}
          </span>
        </div>
      </div>
      <button
        onClick={onComplete}
        disabled={!allAccepted || hasBlockers || disabled}
        className="mt-4 w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {t('markComplete')}
      </button>
    </div>
  )
}
