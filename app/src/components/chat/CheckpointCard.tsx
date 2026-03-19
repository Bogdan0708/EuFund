'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import type { CheckpointData } from '@/hooks/useOrchestrator';

interface CheckpointCardProps {
  checkpoint: CheckpointData;
  onRespond: (response: string) => void;
  disabled?: boolean;
}

export function CheckpointCard({ checkpoint, onRespond, disabled = false }: CheckpointCardProps) {
  const locale = useLocale();
  const [freetextValue, setFreetextValue] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelectOption = (optionId: string, optionLabel: string) => {
    if (disabled) return;
    setSelectedId(optionId);
    onRespond(optionLabel);
  };

  const handleConfirm = (yes: boolean) => {
    if (disabled) return;
    setSelectedId(yes ? 'yes' : 'no');
    onRespond(yes ? 'Yes' : 'No');
  };

  const handleFreetext = () => {
    if (disabled || !freetextValue.trim()) return;
    onRespond(freetextValue.trim());
  };

  return (
    <div
      className="rounded-[var(--radius-md)] border-2 border-[var(--color-accent)] bg-white p-5"
      style={{ boxShadow: 'var(--shadow-md)' }}
    >
      <p
        className="mb-4 font-medium"
        style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text)' }}
      >
        {checkpoint.question}
      </p>

      {/* Select type: option buttons */}
      {checkpoint.type === 'select' && checkpoint.options && (
        <div className="flex flex-col gap-2">
          {checkpoint.options.map((opt) => {
            const isSelected = selectedId === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => handleSelectOption(opt.id, opt.label)}
                disabled={disabled || selectedId !== null}
                className={`flex flex-col items-start rounded-[var(--radius-sm)] border px-4 py-3 text-left
                  transition-all duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
                  ${
                    isSelected
                      ? 'border-[var(--color-accent)] bg-blue-50'
                      : selectedId !== null
                        ? 'cursor-default border-[var(--color-border)] opacity-50'
                        : 'border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-blue-50/50'
                  }
                `}
              >
                <span
                  className="font-medium"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}
                >
                  {opt.label}
                </span>
                {opt.description && (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                    {opt.description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Confirm type: Yes / No */}
      {checkpoint.type === 'confirm' && (
        <div className="flex gap-3">
          <button
            onClick={() => handleConfirm(true)}
            disabled={disabled || selectedId !== null}
            className={`flex-1 rounded-[var(--radius-sm)] border px-4 py-2.5 font-medium
              transition-all duration-200
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
              ${
                selectedId === 'yes'
                  ? 'border-[var(--color-success)] bg-green-50 text-green-700'
                  : selectedId !== null
                    ? 'cursor-default border-[var(--color-border)] opacity-50'
                    : 'border-[var(--color-border)] hover:border-[var(--color-success)] hover:bg-green-50/50'
              }
            `}
            style={{ fontSize: 'var(--font-size-sm)' }}
          >
            {locale === 'ro' ? 'Da' : 'Yes'}
          </button>
          <button
            onClick={() => handleConfirm(false)}
            disabled={disabled || selectedId !== null}
            className={`flex-1 rounded-[var(--radius-sm)] border px-4 py-2.5 font-medium
              transition-all duration-200
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
              ${
                selectedId === 'no'
                  ? 'border-[var(--color-error)] bg-red-50 text-red-700'
                  : selectedId !== null
                    ? 'cursor-default border-[var(--color-border)] opacity-50'
                    : 'border-[var(--color-border)] hover:border-[var(--color-error)] hover:bg-red-50/50'
              }
            `}
            style={{ fontSize: 'var(--font-size-sm)' }}
          >
            {locale === 'ro' ? 'Nu' : 'No'}
          </button>
        </div>
      )}

      {/* Freetext type: text input */}
      {checkpoint.type === 'freetext' && (
        <div className="flex gap-2">
          <input
            type="text"
            value={freetextValue}
            onChange={(e) => setFreetextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleFreetext();
              }
            }}
            disabled={disabled}
            placeholder={locale === 'ro' ? 'Scrie raspunsul tau...' : 'Type your answer...'}
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white
              px-3 py-2.5 text-sm
              placeholder:text-[var(--color-text-secondary)]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
              disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            onClick={handleFreetext}
            disabled={disabled || !freetextValue.trim()}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2.5 font-medium text-white
              transition-colors duration-200
              hover:bg-[var(--color-accent-hover)]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
              disabled:cursor-not-allowed disabled:opacity-50"
            style={{ fontSize: 'var(--font-size-sm)' }}
          >
            {locale === 'ro' ? 'Trimite' : 'Send'}
          </button>
        </div>
      )}
    </div>
  );
}
