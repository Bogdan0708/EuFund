'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';

interface AIBadgeProps {
  source: 'generated' | 'edited';
  model?: string;
  generatedAt?: string;
  confidence?: number;
}

export function AIBadge({ source, model, generatedAt, confidence }: AIBadgeProps) {
  const locale = useLocale();
  const [showTooltip, setShowTooltip] = useState(false);

  const isGenerated = source === 'generated';

  const label = isGenerated
    ? locale === 'ro'
      ? 'Generat de AI'
      : 'AI Generated'
    : locale === 'ro'
      ? 'Editat manual'
      : 'Human Edited';

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        className={`
          inline-flex items-center gap-1 rounded-full px-2 py-0.5
          text-[var(--font-size-xs)] font-medium leading-tight
          transition-colors duration-[var(--transition)]
          ${
            isGenerated
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'bg-green-50 text-green-700 border border-green-200'
          }
        `}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{
          backgroundColor: isGenerated ? 'var(--color-accent)' : 'var(--color-success)',
        }} />
        {label}
      </span>

      {showTooltip && (model || generatedAt || confidence !== undefined) && (
        <span
          className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap
            rounded-[var(--radius-sm)] bg-gray-900 px-3 py-2 text-xs text-white
            shadow-[var(--shadow-lg)]"
        >
          {model && (
            <span className="block">
              {locale === 'ro' ? 'Model' : 'Model'}: {model}
            </span>
          )}
          {generatedAt && (
            <span className="block">
              {locale === 'ro' ? 'Generat' : 'Generated'}: {new Date(generatedAt).toLocaleString(locale)}
            </span>
          )}
          {confidence !== undefined && (
            <span className="block">
              {locale === 'ro' ? 'Incredere' : 'Confidence'}: {Math.round(confidence * 100)}%
            </span>
          )}
        </span>
      )}
    </span>
  );
}
