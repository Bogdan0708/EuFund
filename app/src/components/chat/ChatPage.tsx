'use client';

import { useState, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { ProjectSelector } from './ProjectSelector';
import { QuickStarts } from './QuickStarts';
import { UserMenu } from './UserMenu';

export function ChatPage() {
  const locale = useLocale();
  const {
    messages,
    status,
    sendMessage,
    activeSessionId,
    isStreaming,
    startNewSession,
    resumeSession,
    error,
  } = useOrchestrator(locale);

  // Quick-start pre-filled message triggers a send
  const [pendingQuickStart, setPendingQuickStart] = useState<string | null>(null);

  const handleQuickStart = useCallback(
    (hint: string) => {
      setPendingQuickStart(hint);
      sendMessage(hint);
    },
    [sendMessage],
  );

  const handleNewSession = useCallback(() => {
    startNewSession();
    setPendingQuickStart(null);
  }, [startNewSession]);

  const handleCheckpointRespond = useCallback(
    (response: string) => {
      sendMessage(response);
    },
    [sendMessage],
  );

  const hasMessages = messages.length > 0 || pendingQuickStart !== null;

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* ─── Top Bar ──────────────────────────────────────────── */}
      <header
        className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-white/80
          px-4 py-3 backdrop-blur-sm"
      >
        <div className="flex items-center gap-3">
          {/* Logo */}
          <span className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
            FondEU
          </span>
        </div>

        {/* Project selector */}
        <ProjectSelector
          activeSessionId={activeSessionId}
          onNewSession={handleNewSession}
          onResumeSession={resumeSession}
        />

        {/* User menu */}
        <UserMenu />
      </header>

      {/* ─── Main Content ─────────────────────────────────────── */}
      {!hasMessages ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto">
          <QuickStarts onSelect={handleQuickStart} />
        </div>
      ) : (
        <MessageList
          messages={messages}
          onCheckpointRespond={handleCheckpointRespond}
          isStreaming={isStreaming}
        />
      )}

      {/* ─── Error banner ─────────────────────────────────────── */}
      {error && status === 'error' && (
        <div
          className="mx-auto w-full border-t border-red-200 bg-red-50 px-4 py-2 text-center"
          style={{ maxWidth: 'var(--max-chat-width)', fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }}
        >
          {error}
        </div>
      )}

      {/* ─── Input ────────────────────────────────────────────── */}
      <MessageInput
        onSend={sendMessage}
        disabled={isStreaming}
      />
    </div>
  );
}
