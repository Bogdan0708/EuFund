'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export function CheckpointSelect({
  options,
  onSelect,
  disabled,
}: {
  options: { id: string; label: string; description?: string }[];
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 mt-3">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onSelect(opt.id, opt.label)}
          disabled={disabled}
          className="text-left p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/10 hover:border-primary/30 hover:bg-primary-fixed/5 transition-all duration-200 group disabled:opacity-50 disabled:pointer-events-none"
        >
          <span className="font-medium text-on-surface group-hover:text-primary transition-colors">
            {opt.label}
          </span>
          {opt.description && (
            <p className="text-xs text-on-surface-variant mt-1">
              {opt.description}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}

export function CheckpointConfirm({
  onContinue,
  onModify,
  disabled,
  t,
}: {
  onContinue: () => void;
  onModify: () => void;
  disabled?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex gap-3 mt-3">
      <button
        onClick={onContinue}
        disabled={disabled}
        className="px-5 py-2 bg-primary-container text-white text-sm font-bold rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {t('checkpoint.continue')}
      </button>
      <button
        onClick={onModify}
        disabled={disabled}
        className="px-5 py-2 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-full transition-colors disabled:opacity-50"
      >
        {t('checkpoint.modify')}
      </button>
    </div>
  );
}

export function CheckpointFreetext({
  onSend,
  disabled,
  t,
}: {
  onSend: (text: string) => Promise<boolean>;
  disabled?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [text, setText] = useState('');

  const handleSend = async () => {
    if (!text.trim() || disabled) return;
    const ok = await onSend(text.trim());
    if (ok) setText('');
  };

  return (
    <div className="flex gap-2 mt-3">
      <input
        className="flex-1 bg-surface-container-lowest rounded-full py-2.5 px-4 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 text-sm"
        placeholder={t('checkpoint.typeResponse')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSend();
        }}
        disabled={disabled}
      />
      <button
        disabled={!text.trim() || disabled}
        onClick={handleSend}
        className="px-5 py-2 bg-primary-container text-white text-sm font-bold rounded-full hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {t('checkpoint.sendResponse')}
      </button>
    </div>
  );
}
