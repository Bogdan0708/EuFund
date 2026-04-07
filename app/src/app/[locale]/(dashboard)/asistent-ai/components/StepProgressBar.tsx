'use client';

import { useTranslations } from 'next-intl';
export function StepProgressBar({
  currentStep,
  t,
}: {
  currentStep: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const totalSteps = 5;

  return (
    <div className="flex items-center w-full px-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isCompleted = step < currentStep;
        const isCurrent = step === currentStep;

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            {/* Dot */}
            <div className="flex flex-col items-center gap-1.5 relative">
              <div
                className={`
                  w-3 h-3 rounded-full transition-all duration-300
                  ${isCompleted ? 'bg-primary scale-100' : ''}
                  ${isCurrent ? 'bg-primary ring-4 ring-primary/20 animate-pulse scale-125' : ''}
                  ${!isCompleted && !isCurrent ? 'bg-surface-container-highest scale-100' : ''}
                `}
              />
              <span
                className={`
                  text-[9px] font-bold uppercase tracking-widest whitespace-nowrap absolute top-5
                  ${isCurrent ? 'text-primary' : isCompleted ? 'text-on-surface' : 'text-on-surface-variant opacity-40'}
                `}
              >
                {t(`steps.${step}` as Parameters<typeof t>[0])}
              </span>
            </div>
            {/* Connector line */}
            {step < totalSteps && (
              <div
                className={`
                  flex-1 h-[2px] mx-1 transition-colors duration-300
                  ${step < currentStep ? 'bg-primary' : 'bg-surface-container-high'}
                `}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
