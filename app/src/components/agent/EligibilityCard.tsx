interface Props {
  eligibility: unknown
}

export function EligibilityCard({ eligibility }: Props) {
  const elig = eligibility as { score?: number; passCount?: number; failCount?: number; warningCount?: number } | null
  if (!elig) return null

  const hasFails = (elig.failCount || 0) > 0

  return (
    <div className={`border rounded-xl p-4 ${hasFails ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <h3 className="text-sm font-medium text-gray-900 mb-2">Eligibility Check</h3>
      <div className="flex items-center gap-4 text-xs">
        <span className={`font-medium ${hasFails ? 'text-red-700' : 'text-green-700'}`}>
          Score: {elig.score ?? 0}%
        </span>
        <span className="text-green-600">{elig.passCount ?? 0} passed</span>
        {(elig.failCount || 0) > 0 && <span className="text-red-600">{elig.failCount} failed</span>}
        {(elig.warningCount || 0) > 0 && <span className="text-amber-600">{elig.warningCount} warnings</span>}
      </div>
    </div>
  )
}
