import type { Warning } from '@/lib/ai/agent/types'

interface Props {
  warnings: Warning[]
}

export function WarningsBar({ warnings }: Props) {
  if (warnings.length === 0) return null

  return (
    <div className="mx-4 mt-2 space-y-1">
      {warnings.map((w, i) => (
        <div
          key={`${w.code}-${i}`}
          className={`px-3 py-1.5 rounded-lg text-xs ${
            w.severity === 'blocker' ? 'bg-red-50 text-red-700 border border-red-200'
            : w.severity === 'high' ? 'bg-orange-50 text-orange-700 border border-orange-200'
            : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}
        >
          {w.message}
        </div>
      ))}
    </div>
  )
}
