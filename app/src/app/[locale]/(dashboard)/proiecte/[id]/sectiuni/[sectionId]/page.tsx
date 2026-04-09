'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/ds-icon';
import { SectionStateBadge } from '@/components/ui/section-state-badge';
import { SectionEditor } from '@/components/editor/section-editor';
import { csrfFetch, bootstrapCSRFToken } from '@/lib/csrf/client';
import type { SectionResult } from '@/lib/ai/orchestrator/types';

type SectionsResponse = {
  sections: SectionResult[];
  sessionId: string | null;
  source: 'session' | 'snapshot';
  readOnly: boolean;
};

export default function SectionEditorPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('sectionEditor');
  const projectId = params.id as string;
  const sectionId = params.sectionId as string;

  const [section, setSection] = useState<SectionResult | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef<number>(0);

  // Ref tracking latest mutable state — avoids stale closures in save/timer callbacks
  const latestRef = useRef({ content: '', title: '', readOnly: true, hasSection: false });
  useEffect(() => {
    latestRef.current = { content, title, readOnly, hasSection: section !== null };
  }, [content, title, readOnly, section]);

  // Bootstrap CSRF token on mount
  useEffect(() => { bootstrapCSRFToken(); }, []);

  // Unmount cleanup — cancel pending auto-save
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // Fetch section data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/sections`);
        if (!res.ok) throw new Error('Failed to load sections');
        const data: SectionsResponse = await res.json();
        const sec = data.sections.find((s) => s.id === sectionId);
        if (!sec) throw new Error('Section not found');

        setSection(sec);
        setContent(sec.content);
        setTitle(sec.title);
        setReadOnly(data.readOnly);
        versionRef.current = sec.currentVersion;
      } catch {
        setError(t('loadError'));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, sectionId]);

  // Stable save — reads from latestRef, no stale closures
  const save = useCallback(async () => {
    const { content: c, title: t2, readOnly: ro, hasSection } = latestRef.current;
    if (ro || !hasSection) return;
    setSaveStatus('saving');
    setError(null);

    try {
      const res = await csrfFetch(`/api/v1/projects/${projectId}/sections/${sectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: c,
          title: t2,
          expectedCurrentVersion: versionRef.current,
        }),
      });

      if (res.status === 409) {
        setError(t('conflictError'));
        setSaveStatus('error');
        return;
      }

      if (!res.ok) throw new Error('Save failed');

      const data = await res.json();
      versionRef.current = data.section.currentVersion;
      setSection(data.section);
      setIsDirty(false);
      setSaveStatus('saved');
    } catch {
      setError(t('saveError'));
      setSaveStatus('error');
    }
  }, [projectId, sectionId, t]);

  // Single debounced save path — used by both content and title changes
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { save(); }, 3000);
  }, [save]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    setIsDirty(true);
    setSaveStatus('idle');
    scheduleSave();
  }, [scheduleSave]);

  // beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-8 space-y-6">
        <div className="animate-pulse bg-surface-container rounded-xl h-8 w-48" />
        <div className="animate-pulse bg-surface-container rounded-xl h-[500px]" />
      </div>
    );
  }

  if (error && !section) {
    return (
      <div className="max-w-5xl mx-auto py-8 text-center">
        <p className="text-on-surface-variant">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8">
      {/* Breadcrumb */}
      <button
        onClick={() => {
          if (isDirty && !window.confirm(t('unsavedChanges'))) return;
          router.push(`/${params.locale}/proiecte/${projectId}?tab=sections`);
        }}
        className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface mb-6 transition-colors"
      >
        <Icon name="arrow_back" size="sm" />
        {t('backToProject')}
      </button>

      {/* Read-only banner */}
      {readOnly && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm text-amber-700">
          {t('readOnlyBanner')}
        </div>
      )}

      {/* Title + status bar */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1">
          {readOnly ? (
            <h1 className="text-2xl font-bold text-on-surface">{title}</h1>
          ) : (
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setIsDirty(true);
                setSaveStatus('idle');
                scheduleSave();
              }}
              className="text-2xl font-bold text-on-surface bg-transparent border-none outline-none w-full focus:ring-0 p-0"
              placeholder={t('editTitle')}
            />
          )}
          <div className="flex items-center gap-3 mt-2">
            {section && <SectionStateBadge state={section.state} />}
            <span className="text-xs text-on-surface-variant">
              {t('version', { version: versionRef.current })}
            </span>
          </div>
        </div>

        {/* Save status */}
        <div className="flex items-center gap-3" aria-live="polite">
          {saveStatus === 'saving' && (
            <span className="text-xs text-on-surface-variant">{t('saving')}</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-xs text-green-600">{t('saved')}</span>
          )}
          {saveStatus === 'error' && error && (
            <span className="text-xs text-red-600">{error}</span>
          )}
          {!readOnly && (
            <button
              onClick={() => {
                if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
                save();
              }}
              disabled={!isDirty || saveStatus === 'saving'}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {t('save')}
            </button>
          )}
          <a
            href={`/api/v1/projects/${projectId}/sections/${sectionId}/export?format=docx`}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            {t('exportDocx')}
          </a>
        </div>
      </div>

      {/* Editor */}
      <SectionEditor
        value={content}
        onChange={handleContentChange}
        readOnly={readOnly}
        editorKey={versionRef.current}
      />
    </div>
  );
}
