interface Props {
  blueprint: unknown
}

export function BlueprintCard({ blueprint }: Props) {
  const bp = blueprint as Record<string, unknown> | null
  if (!bp) return null

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <h3 className="text-sm font-medium text-gray-900 mb-2">Call Blueprint</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-gray-500">Program</dt>
        <dd className="text-gray-900 font-medium">{String(bp.program || '—')}</dd>
        <dt className="text-gray-500">Call ID</dt>
        <dd className="text-gray-900">{String(bp.callId || '—')}</dd>
        <dt className="text-gray-500">Confidence</dt>
        <dd className="text-gray-900">{bp.structureConfidence ? `${Math.round(Number(bp.structureConfidence) * 100)}%` : '—'}</dd>
        <dt className="text-gray-500">Co-financing</dt>
        <dd className="text-gray-900">{bp.cofinancingRate ? `${Math.round(Number(bp.cofinancingRate) * 100)}%` : '—'}</dd>
      </dl>
    </div>
  )
}
