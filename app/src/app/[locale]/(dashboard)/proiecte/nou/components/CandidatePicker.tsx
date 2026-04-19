'use client'

import { useTranslations } from 'next-intl'
import type { Candidate } from '@/lib/preselect/client'

interface CandidatePickerProps {
  candidates: Candidate[]
  onSelect: (callId: string) => void
  disabled?: boolean
}

export function CandidatePicker({ candidates, onSelect, disabled }: CandidatePickerProps) {
  const t = useTranslations('preselect.picker')
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-base font-semibold text-gray-900">{t('title')}</h3>
      <p className="mt-1 text-sm text-gray-600">{t('subtitle')}</p>
      <ul className="mt-3 space-y-2">
        {candidates.map((c) => (
          <li key={c.callId}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(c.callId)}
              className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-left hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
            >
              <div>
                <div className="font-medium text-gray-900">{c.title}</div>
                {c.program && (
                  <div className="text-xs text-gray-500">{c.program}</div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <ScoreBar score={c.score} />
                <span className="text-sm font-medium text-blue-600">{t('select')}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  return (
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
      <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
    </div>
  )
}
