'use client'

interface StepProgressBarProps {
  currentStep: number
  className?: string
}

const STEP_LABELS = [
  'Enhance', 'Match', 'Validate', 'Research', 'Knowledge', 'Plan', 'Build'
]

export function StepProgressBar({ currentStep, className = '' }: StepProgressBarProps) {
  if (currentStep < 1 || currentStep > 7) return null

  return (
    <div className={`flex items-center gap-2 px-4 py-3 ${className}`}>
      {STEP_LABELS.map((label, i) => {
        const step = i + 1
        const isPast = step < currentStep
        const isCurrent = step === currentStep
        return (
          <div key={step} className="flex items-center gap-2 flex-1">
            <div className={`
              w-2.5 h-2.5 rounded-full transition-all shrink-0
              ${isPast ? 'bg-[var(--success)]' : isCurrent ? 'bg-[var(--accent)] scale-125' : 'bg-[var(--border-subtle)]'}
            `} />
            {isCurrent && <span className="text-xs text-[var(--text-secondary)] truncate hidden md:inline">{label}</span>}
            {i < 6 && <div className={`flex-1 h-px ${isPast ? 'bg-[var(--success)]' : 'bg-[var(--border-subtle)]'}`} />}
          </div>
        )
      })}
      <span className="text-xs text-[var(--text-tertiary)] ml-2 shrink-0">{currentStep}/7</span>
    </div>
  )
}
