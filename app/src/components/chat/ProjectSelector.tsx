'use client';

import { useState, useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';

interface SessionItem {
  id: string;
  currentStep: number;
  status: string;
  projectId: string | null;
  projectTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectSelectorProps {
  activeSessionId: string | null;
  onNewSession: () => void;
  onResumeSession?: (sessionId: string) => void;
}

export function ProjectSelector({
  activeSessionId,
  onNewSession,
  onResumeSession,
}: ProjectSelectorProps) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Fetch sessions when dropdown opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/ai/orchestrator/sessions')
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((data) => setSessions(data.sessions || []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [open]);

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return locale === 'ro' ? 'acum' : 'just now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
  }

  function sessionLabel(s: SessionItem): string {
    if (s.projectTitle) return s.projectTitle;
    if (s.status === 'completed') return locale === 'ro' ? 'Proiect finalizat' : 'Completed project';
    return locale === 'ro' ? `Pas ${s.currentStep}/7` : `Step ${s.currentStep}/7`;
  }

  function statusDot(s: SessionItem): string {
    if (s.status === 'completed') return 'bg-green-400';
    if (s.status === 'active') return 'bg-blue-400';
    return 'bg-gray-300';
  }

  const otherSessions = sessions.filter((s) => s.id !== activeSessionId);

  return (
    <div className="relative" ref={menuRef}>
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

        {/* Dropdown trigger */}
        <button
          onClick={() => setOpen(!open)}
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
          {otherSessions.length > 0 && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={`ml-0.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            >
              <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 overflow-hidden rounded-[var(--radius-lg)]
            border border-[var(--color-border)] bg-white shadow-[var(--shadow-lg)]"
        >
          {/* New session */}
          <button
            onClick={() => {
              onNewSession();
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors
              hover:bg-[var(--color-bg-secondary)]"
            style={{ color: 'var(--color-accent)' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 4v8M4 8h8" strokeLinecap="round" />
            </svg>
            {locale === 'ro' ? 'Proiect nou' : 'New project'}
          </button>

          {/* Recent sessions */}
          {loading && (
            <div className="px-4 py-3 text-center text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {locale === 'ro' ? 'Se incarca...' : 'Loading...'}
            </div>
          )}

          {!loading && otherSessions.length > 0 && (
            <>
              <div className="border-t border-[var(--color-border)] px-4 py-2">
                <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {locale === 'ro' ? 'Sesiuni recente' : 'Recent sessions'}
                </p>
              </div>
              {otherSessions.slice(0, 5).map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    onResumeSession?.(s.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors
                    hover:bg-[var(--color-bg-secondary)]"
                  style={{ color: 'var(--color-text)' }}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(s)}`} />
                  <span className="flex-1 truncate">{sessionLabel(s)}</span>
                  <span className="shrink-0 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {formatDate(s.updatedAt)}
                  </span>
                </button>
              ))}
            </>
          )}

          {!loading && otherSessions.length === 0 && (
            <div className="border-t border-[var(--color-border)] px-4 py-3 text-center text-xs"
              style={{ color: 'var(--color-text-secondary)' }}>
              {locale === 'ro' ? 'Nicio sesiune anterioară' : 'No previous sessions'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
