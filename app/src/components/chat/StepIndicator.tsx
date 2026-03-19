'use client';

import { useLocale } from 'next-intl';

const STEP_LABELS: Record<number, { ro: string; en: string }> = {
  1: { ro: 'Imbunatatim ideea ta...', en: 'Enhancing your idea...' },
  2: { ro: 'Cautam apeluri potrivite...', en: 'Matching with funding calls...' },
  3: { ro: 'Verificam starea apelurilor...', en: 'Validating funding call status...' },
  4: { ro: 'Cercetam cerintele...', en: 'Researching requirements...' },
  5: { ro: 'Actualizam baza de cunostinte...', en: 'Updating knowledge base...' },
  6: { ro: 'Cream planul de actiune...', en: 'Creating action plan...' },
  7: { ro: 'Construim proiectul tau...', en: 'Building your project...' },
};

const TOTAL_STEPS = 7;

interface StepIndicatorProps {
  currentStep: number;
  className?: string;
}

export function StepIndicator({ currentStep, className = '' }: StepIndicatorProps) {
  const locale = useLocale();

  if (currentStep < 1 || currentStep > TOTAL_STEPS) return null;

  const label = STEP_LABELS[currentStep];

  return (
    <div
      className={`flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)]
        bg-[var(--color-bg-secondary)] px-4 py-3 ${className}`}
    >
      {/* Step dots */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => {
          const stepNum = i + 1;
          const isActive = stepNum === currentStep;
          const isComplete = stepNum < currentStep;
          return (
            <div
              key={stepNum}
              className="h-2 w-2 rounded-full transition-all duration-200"
              style={{
                backgroundColor: isActive
                  ? 'var(--color-accent)'
                  : isComplete
                    ? 'var(--color-success)'
                    : 'var(--color-border)',
                transform: isActive ? 'scale(1.3)' : 'scale(1)',
              }}
            />
          );
        })}
      </div>

      {/* Step label */}
      <span
        className="font-medium"
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
      >
        {locale === 'ro' ? label.ro : label.en}
      </span>

      {/* Step counter */}
      <span
        className="ml-auto tabular-nums"
        style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
      >
        {currentStep}/{TOTAL_STEPS}
      </span>
    </div>
  );
}
