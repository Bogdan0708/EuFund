'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { AgentSectionState } from '@/hooks/useAgent'

interface Props {
  section: AgentSectionState
  onAccept: () => void
  onReject: () => void
  disabled?: boolean
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-600' },
  generating: { bg: 'bg-blue-100', text: 'text-blue-700' },
  draft: { bg: 'bg-amber-100', text: 'text-amber-700' },
  accepted: { bg: 'bg-green-100', text: 'text-green-700' },
  stale: { bg: 'bg-orange-100', text: 'text-orange-700' },
  invalidated: { bg: 'bg-red-100', text: 'text-red-700' },
  needs_review: { bg: 'bg-purple-100', text: 'text-purple-700' },
  failed: { bg: 'bg-red-100', text: 'text-red-700' },
}

const PREVIEW_CHARS = 600

export function SectionCard({ section, onAccept, onReject, disabled = false }: Props) {
  const t = useTranslations('agent')
  const style = STATUS_STYLES[section.status] || STATUS_STYLES.pending
  const [expanded, setExpanded] = useState(false)
  const content = section.content ?? ''
  const isLong = content.length > PREVIEW_CHARS
  const visible = expanded || !isLong ? content : content.slice(0, PREVIEW_CHARS) + '…'

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-900">{section.title}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
          {t(`sectionStatus.${section.status}`)}
        </span>
      </div>
      {content && (
        <div className="mt-2">
          <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 font-sans leading-relaxed">{visible}</pre>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="mt-2 text-xs text-blue-600 hover:text-blue-800"
            >
              {expanded ? t('showLess') : t('showMore')}
            </button>
          )}
        </div>
      )}
      {section.status === 'draft' && (
        <div className="flex gap-2 mt-3">
          <button onClick={onAccept} disabled={disabled} className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {t('accept')}
          </button>
          <button onClick={onReject} disabled={disabled} className="text-xs px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {t('revise')}
          </button>
        </div>
      )}
    </div>
  )
}
