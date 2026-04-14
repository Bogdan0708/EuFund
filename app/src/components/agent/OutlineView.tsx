import type { AgentSectionState } from '@/hooks/useAgent'

interface Props {
  sections: AgentSectionState[]
  onApprove: () => void
}

export function OutlineView({ sections, onApprove }: Props) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900">Application Outline</h3>
        <button
          onClick={onApprove}
          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Approve & Start Drafting
        </button>
      </div>
      <ol className="space-y-1.5">
        {sections
          .sort((a, b) => a.documentOrder - b.documentOrder)
          .map((s, i) => (
            <li key={s.sectionKey} className="flex items-center gap-2 text-sm">
              <span className="text-xs text-gray-400 w-5 text-right">{i + 1}.</span>
              <span className="text-gray-900">{s.title}</span>
            </li>
          ))}
      </ol>
    </div>
  )
}
