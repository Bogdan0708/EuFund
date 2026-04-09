'use client';

import { useTranslations } from 'next-intl';

interface SectionStateBadgeProps {
  state: 'draft' | 'reviewed' | 'approved';
  className?: string;
}

const STATE_STYLES: Record<string, string> = {
  draft: 'bg-surface-container text-on-surface-variant',
  reviewed: 'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
};

export function SectionStateBadge({ state, className }: SectionStateBadgeProps) {
  const t = useTranslations('sectionEditor');
  const style = STATE_STYLES[state] ?? STATE_STYLES.draft;
  const key = `state${state.charAt(0).toUpperCase()}${state.slice(1)}` as 'stateDraft' | 'stateReviewed' | 'stateApproved';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style} ${className ?? ''}`}>
      {t(key)}
    </span>
  );
}
