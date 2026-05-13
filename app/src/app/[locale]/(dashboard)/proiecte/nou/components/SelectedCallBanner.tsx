'use client'

import { useTranslations } from 'next-intl'

interface SelectedCallBannerProps {
  callTitle: string
  outlineFrozen: boolean
  onChangeRequested: () => void
}

export function SelectedCallBanner({
  callTitle,
  outlineFrozen,
  onChangeRequested,
}: SelectedCallBannerProps) {
  const t = useTranslations('preselect.banner')
  return (
    <div data-testid="selected-call-banner" className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm">
      <div>
        <span className="font-medium text-gray-500">{t('label')}:</span>{' '}
        <span className="font-semibold text-gray-900">{callTitle}</span>
      </div>
      {!outlineFrozen && (
        <button
          type="button"
          onClick={onChangeRequested}
          className="text-blue-600 hover:text-blue-700 font-medium"
        >
          {t('change')}
        </button>
      )}
    </div>
  )
}
