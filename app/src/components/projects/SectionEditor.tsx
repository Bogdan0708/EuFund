'use client';

import { useCallback, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { AIBadge } from '@/components/chat/AIBadge';

export interface ProjectSection {
  title: string;
  content: string;
  order: number;
  source: 'generated' | 'edited';
}

interface SectionEditorProps {
  section: ProjectSection;
  onChange: (updated: ProjectSection) => void;
}

export function SectionEditor({ section, onChange }: SectionEditorProps) {
  const locale = useLocale();
  const [value, setValue] = useState(section.content);
  const [saving, setSaving] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBlur = useCallback(() => {
    if (value !== section.content) {
      setSaving(true);
      onChange({
        ...section,
        content: value,
        source: 'edited',
      });
      // Simulate save feedback
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setSaving(false), 600);
    }
  }, [value, section, onChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text)]">
          {section.title}
        </h4>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
              {locale === 'ro' ? 'Salvat' : 'Saved'}
            </span>
          )}
          <AIBadge source={value !== section.content ? 'edited' : section.source} />
        </div>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        rows={6}
        className="resize-y rounded-[var(--radius-sm)] border-[var(--color-border)]
          text-[var(--font-size-sm)] transition-shadow duration-[var(--transition)]
          focus:shadow-[var(--shadow-sm)]"
        placeholder={locale === 'ro' ? 'Adauga continut...' : 'Add content...'}
      />
    </div>
  );
}
