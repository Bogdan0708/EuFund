'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useLocale } from 'next-intl';
import Link from 'next/link';

export function UserMenu() {
  const { data: session } = useSession();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
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

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-[var(--radius-full)] border border-[var(--color-border)]
          bg-white px-2 py-1.5 transition-all duration-200
          hover:border-[var(--color-accent)] hover:shadow-[var(--shadow-sm)]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {user?.image ? (
          <img
            src={user.image}
            alt=""
            className="h-7 w-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {initials}
          </div>
        )}
        <span
          className="hidden text-sm font-medium sm:block"
          style={{ color: 'var(--color-text)', maxWidth: 120 }}
        >
          {user?.name?.split(' ')[0] || user?.email?.split('@')[0] || ''}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-[var(--radius-lg)]
            border border-[var(--color-border)] bg-white shadow-[var(--shadow-lg)]"
          role="menu"
        >
          {/* User info */}
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {user?.name || ''}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {user?.email || ''}
            </p>
          </div>

          {/* Navigation */}
          <div className="py-1">
            <Link
              href={`/${locale}/proiecte`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                hover:bg-[var(--color-bg-secondary)]"
              style={{ color: 'var(--color-text)' }}
              role="menuitem"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="12" height="11" rx="2" />
                <path d="M2 7h12" />
                <path d="M6 7V3" />
              </svg>
              {locale === 'ro' ? 'Proiectele mele' : 'My Projects'}
            </Link>
            <Link
              href={`/${locale}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                hover:bg-[var(--color-bg-secondary)]"
              style={{ color: 'var(--color-text)' }}
              role="menuitem"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 13V7l5-4 5 4v6a1 1 0 01-1 1H4a1 1 0 01-1-1z" />
                <path d="M6 13V9h4v4" />
              </svg>
              {locale === 'ro' ? 'Asistent AI' : 'AI Assistant'}
            </Link>
            <Link
              href={`/${locale}/billing`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                hover:bg-[var(--color-bg-secondary)]"
              style={{ color: 'var(--color-text)' }}
              role="menuitem"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="4" width="12" height="9" rx="1.5" />
                <path d="M2 7.5h12" />
              </svg>
              {locale === 'ro' ? 'Abonament' : 'Subscription'}
            </Link>
          </div>

          {/* Sign out */}
          <div className="border-t border-[var(--color-border)] py-1">
            <button
              onClick={() => signOut({ callbackUrl: `/${locale}/autentificare` })}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors
                hover:bg-[var(--color-bg-secondary)]"
              style={{ color: 'var(--color-error, #dc2626)' }}
              role="menuitem"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 14H3.5A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H6" />
                <path d="M11 11l3-3-3-3" />
                <path d="M14 8H6" />
              </svg>
              {locale === 'ro' ? 'Deconectare' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
