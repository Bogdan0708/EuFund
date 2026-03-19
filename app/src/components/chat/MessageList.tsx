'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@/hooks/useOrchestrator';
import { StepIndicator } from './StepIndicator';
import { CheckpointCard } from './CheckpointCard';
import { AIBadge } from './AIBadge';

/**
 * Simple inline markdown renderer. Converts common markdown patterns to HTML.
 * Safe for use with dangerouslySetInnerHTML because content comes from our AI backend.
 */
function renderMarkdown(text: string): string {
  let html = text;

  // Escape HTML entities first
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (triple backtick) — must come before inline code
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, _lang, code) =>
      `<pre class="my-2 overflow-x-auto rounded bg-gray-100 p-3 text-xs"><code>${code.trim()}</code></pre>`,
  );

  // Inline code (single backtick)
  html = html.replace(
    /`([^`\n]+)`/g,
    '<code class="rounded bg-gray-100 px-1.5 py-0.5 text-xs">$1</code>',
  );

  // Bold (**text**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic (*text*) — but not inside already-matched bold
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline" style="color:var(--color-accent)">$1</a>',
  );

  // Line breaks
  html = html.replace(/\n/g, '<br />');

  return html;
}

interface MessageListProps {
  messages: ChatMessage[];
  currentStep: number;
  onCheckpointRespond: (response: string) => void;
  isStreaming: boolean;
}

export function MessageList({
  messages,
  currentStep,
  onCheckpointRespond,
  isStreaming,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Track which steps we've rendered an indicator for
  let lastRenderedStep = 0;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-6"
    >
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 'var(--max-chat-width)' }}>
        {messages.map((msg) => {
          const elements: React.ReactNode[] = [];

          // Insert step indicator when step changes
          if (msg.eventType === 'step_start' && msg.step && msg.step !== lastRenderedStep) {
            lastRenderedStep = msg.step;
            elements.push(
              <StepIndicator
                key={`step-indicator-${msg.step}`}
                currentStep={msg.step}
                className="my-2"
              />,
            );
            // Don't render the step_start message itself — the indicator is enough
            return <>{elements}</>;
          }

          // Skip step_progress messages — they are transient status updates
          if (msg.eventType === 'step_progress') {
            return null;
          }

          // Checkpoint card
          if (msg.eventType === 'checkpoint' && msg.checkpoint) {
            elements.push(
              <CheckpointCard
                key={msg.id}
                checkpoint={msg.checkpoint}
                onRespond={onCheckpointRespond}
                disabled={isStreaming}
              />,
            );
            return <>{elements}</>;
          }

          // Error message
          if (msg.eventType === 'error') {
            elements.push(
              <div
                key={msg.id}
                className="rounded-[var(--radius-sm)] border border-red-200 bg-red-50 px-4 py-3"
                style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}
              >
                {msg.content}
              </div>,
            );
            return <>{elements}</>;
          }

          // User message
          if (msg.role === 'user') {
            elements.push(
              <div key={msg.id} className="flex justify-end">
                <div
                  className="max-w-[80%] rounded-[var(--radius-md)] px-4 py-3"
                  style={{
                    backgroundColor: 'var(--color-accent)',
                    color: 'white',
                    fontSize: 'var(--font-size-sm)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>,
            );
            return <>{elements}</>;
          }

          // Assistant message (ai_chunk, step_complete, etc.)
          if (msg.role === 'assistant') {
            const isStepComplete = msg.eventType === 'step_complete';
            elements.push(
              <div key={msg.id} className="flex justify-start">
                <div
                  className={`max-w-[80%] rounded-[var(--radius-md)] px-4 py-3 ${
                    isStepComplete ? 'border border-[var(--color-border)]' : ''
                  }`}
                  style={{
                    backgroundColor: isStepComplete ? 'var(--color-bg-secondary)' : 'var(--color-bg-secondary)',
                    color: 'var(--color-text)',
                    fontSize: 'var(--font-size-sm)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div
                    className="leading-relaxed [&>br+br]:block [&>br+br]:h-2 [&>pre]:whitespace-pre-wrap [&>strong]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                  {msg.eventType === 'ai_chunk' && (
                    <div className="mt-2">
                      <AIBadge source="generated" />
                    </div>
                  )}
                </div>
              </div>,
            );
            return <>{elements}</>;
          }

          return null;
        })}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
