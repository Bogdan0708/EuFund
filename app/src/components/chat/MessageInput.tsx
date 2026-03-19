'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useLocale } from 'next-intl';

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  /** Pre-fill the input (e.g. from QuickStarts) and auto-send */
  initialMessage?: string;
}

export function MessageInput({ onSend, disabled = false, initialMessage }: MessageInputProps) {
  const locale = useLocale();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sentInitialRef = useRef(false);

  // Auto-send initial message once
  useEffect(() => {
    if (initialMessage && !sentInitialRef.current) {
      sentInitialRef.current = true;
      onSend(initialMessage);
    }
  }, [initialMessage, onSend]);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const placeholder = locale === 'ro'
    ? 'Scrie un mesaj...'
    : 'Type a message...';

  return (
    <div className="border-t border-[var(--color-border)] bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex w-full items-end gap-2 px-4 py-3" style={{ maxWidth: 'var(--max-chat-width)' }}>
        {/* File attach button (placeholder for future) */}
        <button
          type="button"
          disabled={disabled}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full
            text-[var(--color-text-secondary)] transition-colors duration-200
            hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]
            disabled:cursor-not-allowed disabled:opacity-50"
          title={locale === 'ro' ? 'Ataseaza fisier' : 'Attach file'}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14.5 10.5l-5 5a3.5 3.5 0 01-5-5l6.5-6.5a2.5 2.5 0 013.5 3.5l-6.5 6.5a1.5 1.5 0 01-2-2l5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="max-h-[200px] min-h-[40px] flex-1 resize-none rounded-[var(--radius-md)] border
            border-[var(--color-border)] bg-white px-4 py-2.5 text-sm leading-relaxed
            placeholder:text-[var(--color-text-secondary)]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
            disabled:cursor-not-allowed disabled:opacity-50"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full
            bg-[var(--color-accent)] text-white transition-all duration-200
            hover:bg-[var(--color-accent-hover)]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
            disabled:cursor-not-allowed disabled:opacity-50"
          title={locale === 'ro' ? 'Trimite' : 'Send'}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path d="M2.5 15.5l13-6.5-13-6.5v5l9 1.5-9 1.5z" />
          </svg>
        </button>
      </div>

      {/* Streaming indicator */}
      {disabled && (
        <div className="mx-auto pb-2 text-center" style={{ maxWidth: 'var(--max-chat-width)' }}>
          <span
            className="inline-flex items-center gap-1.5"
            style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
            {locale === 'ro' ? 'Se proceseaza...' : 'Processing...'}
          </span>
        </div>
      )}
    </div>
  );
}
