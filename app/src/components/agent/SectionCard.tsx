import type { AgentSectionState } from '@/hooks/useAgent'

interface Props {
  section: AgentSectionState
  onAccept: () => void
  onReject: () => void
  disabled?: boolean
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Pending' },
  generating: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Generating...' },
  draft: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Draft' },
  accepted: { bg: 'bg-green-100', text: 'text-green-700', label: 'Accepted' },
  stale: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Stale' },
  invalidated: { bg: 'bg-red-100', text: 'text-red-700', label: 'Invalidated' },
  needs_review: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Needs Review' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed' },
}

export function SectionCard({ section, onAccept, onReject, disabled = false }: Props) {
  const style = STATUS_STYLES[section.status] || STATUS_STYLES.pending

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-900">{section.title}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
          {style.label}
        </span>
      </div>
      {section.status === 'draft' && (
        <div className="flex gap-2 mt-3">
          <button onClick={onAccept} disabled={disabled} className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            Accept
          </button>
          <button onClick={onReject} disabled={disabled} className="text-xs px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            Revise
          </button>
        </div>
      )}
    </div>
  )
}
