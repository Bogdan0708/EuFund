'use client';

import { useLocale } from 'next-intl';

interface ProjectSelectorProps {
  activeSessionId: string | null;
  onNewSession: () => void;
}

export function ProjectSelector({
  activeSessionId,
  onNewSession,
}: ProjectSelectorProps) {
  const locale = useLocale();

  return (
    <div className="flex items-center gap-2">
      {/* Active session pill */}
      {activeSessionId && (
        <span
          className="rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]
            px-3 py-1.5 text-xs font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {locale === 'ro' ? 'Sesiune activă' : 'Current session'}
        </span>
      )}

      {/* New session button */}
      <button
        onClick={onNewSession}
        className="flex items-center gap-1.5 rounded-[var(--radius-full)] border border-[var(--color-border)]
          bg-white px-4 py-1.5 text-sm font-medium transition-all duration-200
          hover:border-[var(--color-accent)] hover:shadow-[var(--shadow-sm)]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        style={{ color: 'var(--color-accent)' }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M7 3v8M3 7h8" strokeLinecap="round" />
        </svg>
        {locale === 'ro' ? 'Proiect nou' : 'New project'}
      </button>
    </div>
  );
}
