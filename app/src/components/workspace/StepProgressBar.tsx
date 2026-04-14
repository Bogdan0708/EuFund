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
              ${isPast ? 'bg-tertiary' : isCurrent ? 'bg-primary scale-125' : 'bg-outline-variant'}
            `} />
            {isCurrent && <span className="text-xs text-on-surface-variant truncate hidden md:inline">{label}</span>}
            {i < 6 && <div className={`flex-1 h-px ${isPast ? 'bg-tertiary' : 'bg-outline-variant'}`} />}
          </div>
        )
      })}
      <span className="text-xs text-outline ml-2 shrink-0">{currentStep}/7</span>
    </div>
  )
}
