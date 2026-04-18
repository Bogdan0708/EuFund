'use client'

import { useTranslations } from 'next-intl'

interface NoMatchGuidanceProps {
  onRetry: () => void
}

export function NoMatchGuidance({ onRetry }: NoMatchGuidanceProps) {
  const t = useTranslations('preselect.noMatch')
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-base font-semibold text-amber-900">{t('title')}</h3>
      <p className="mt-2 text-sm text-amber-800">{t('hint')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
      >
        {t('retry')}
      </button>
    </div>
  )
}
