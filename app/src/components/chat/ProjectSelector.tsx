'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocale } from 'next-intl';

interface Session {
  id: string;
  label: string;
}

interface ProjectSelectorProps {
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
}

export function ProjectSelector({
  activeSessionId,
  onNewSession,
  onSelectSession,
}: ProjectSelectorProps) {
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load recent sessions from projects API
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/v1/projects?limit=10&sort=updatedAt:desc');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success && data.data?.items) {
          setSessions(
            data.data.items.map((p: { id: string; title?: string; name?: string }) => ({
              id: p.id,
              label: p.title || p.name || p.id.slice(0, 8),
            })),
          );
        }
      } catch {
        // Silently fail
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const currentLabel = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)?.label || activeSessionId.slice(0, 8)
    : locale === 'ro'
      ? 'Sesiune noua'
      : 'New session';

  const handleSelect = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId);
      setIsOpen(false);
    },
    [onSelectSession],
  );

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-[var(--radius-full)] border border-[var(--color-border)]
          bg-white px-4 py-2 text-sm font-medium transition-all duration-200
          hover:border-[var(--color-accent)] hover:shadow-[var(--shadow-sm)]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        style={{ color: 'var(--color-text)' }}
      >
        <span className="max-w-[160px] truncate">{currentLabel}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-[var(--radius-md)] border border-[var(--color-border)]
            bg-white py-1"
          style={{ boxShadow: 'var(--shadow-lg)' }}
        >
          {/* New session option */}
          <button
            onClick={() => {
              onNewSession();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-colors
              hover:bg-[var(--color-bg-secondary)]"
            style={{ color: 'var(--color-accent)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 3v8M3 7h8" strokeLinecap="round" />
            </svg>
            {locale === 'ro' ? 'Proiect nou' : 'New project'}
          </button>

          {sessions.length > 0 && (
            <div className="my-1 border-t border-[var(--color-border)]" />
          )}

          {/* Recent sessions */}
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => handleSelect(session.id)}
              className={`flex w-full items-center px-4 py-2.5 text-sm transition-colors
                hover:bg-[var(--color-bg-secondary)]
                ${session.id === activeSessionId ? 'font-medium' : ''}
              `}
              style={{
                color: session.id === activeSessionId ? 'var(--color-accent)' : 'var(--color-text)',
              }}
            >
              <span className="truncate">{session.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
