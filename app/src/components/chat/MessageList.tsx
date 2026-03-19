'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@/hooks/useOrchestrator';
import { StepIndicator } from './StepIndicator';
import { CheckpointCard } from './CheckpointCard';
import { AIBadge } from './AIBadge';

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
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
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
