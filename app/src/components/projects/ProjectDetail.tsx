'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { SectionEditor, type ProjectSection } from './SectionEditor';
import { FilesTab } from './FilesTab';
import type { Project } from './ProjectCard';

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
}

// Mock sections for now — the API may not have a sections field yet
const mockSections: ProjectSection[] = [
  { title: 'Rezumatul proiectului', content: '', order: 1, source: 'generated' },
  { title: 'Contextul si justificarea', content: '', order: 2, source: 'generated' },
  { title: 'Obiective', content: '', order: 3, source: 'generated' },
  { title: 'Activitati si calendar', content: '', order: 4, source: 'generated' },
  { title: 'Buget', content: '', order: 5, source: 'generated' },
  { title: 'Echipa de proiect', content: '', order: 6, source: 'generated' },
  { title: 'Indicatori de rezultat', content: '', order: 7, source: 'generated' },
  { title: 'Sustenabilitate', content: '', order: 8, source: 'generated' },
];

type Tab = 'sections' | 'files';

export function ProjectDetail({ project, onBack }: ProjectDetailProps) {
  const locale = useLocale();
  const [sections, setSections] = useState<ProjectSection[]>(mockSections);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<Tab>('sections');
  const [exporting, setExporting] = useState(false);

  // Try fetching real sections from API
  useEffect(() => {
    let cancelled = false;
    async function fetchSections() {
      try {
        const res = await fetch(`/api/v1/projects/${project.id}`);
        if (!res.ok) return;
        const payload = await res.json();
        const data = payload?.data;
        if (data?.sections && Array.isArray(data.sections) && data.sections.length > 0 && !cancelled) {
          setSections(data.sections);
        }
      } catch {
        // Fall back to mock sections
      }
    }
    fetchSections();
    return () => { cancelled = true; };
  }, [project.id]);

  const toggleCollapse = useCallback((order: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(order)) {
        next.delete(order);
      } else {
        next.add(order);
      }
      return next;
    });
  }, []);

  const handleSectionChange = useCallback((updated: ProjectSection) => {
    setSections((prev) =>
      prev.map((s) => (s.order === updated.order ? updated : s))
    );
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const csrfRes = await fetch('/api/auth/csrf');
      const csrfToken = csrfRes.headers.get('X-CSRF-Token') || '';

      const res = await fetch(`/api/v1/projects/${project.id}/export`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.acronym || project.title}.docx`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // Export failed silently for now
    } finally {
      setExporting(false);
    }
  }, [project]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-sm)]
              border border-[var(--color-border)] bg-[var(--color-bg)]
              text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]
              transition-colors duration-[var(--transition)]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            aria-label={locale === 'ro' ? 'Inapoi la proiecte' : 'Back to projects'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div>
            <h2 className="text-[var(--font-size-xl)] font-semibold text-[var(--color-text)]">
              {project.title}
            </h2>
            {project.acronym && (
              <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                {project.acronym}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge kind="project" value={project.status} />
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting
              ? (locale === 'ro' ? 'Se exporta...' : 'Exporting...')
              : (locale === 'ro' ? 'Exporta DOCX' : 'Export DOCX')}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {(['sections', 'files'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-[var(--font-size-sm)] font-medium transition-colors duration-[var(--transition)]
              border-b-2 -mb-px
              ${activeTab === tab
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
          >
            {tab === 'sections'
              ? (locale === 'ro' ? 'Sectiuni' : 'Sections')
              : (locale === 'ro' ? 'Fisiere' : 'Files')}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'sections' ? (
        <div className="space-y-4">
          {sections
            .sort((a, b) => a.order - b.order)
            .map((section) => {
              const isCollapsed = collapsedSections.has(section.order);
              return (
                <div
                  key={section.order}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]
                    shadow-[var(--shadow-sm)] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleCollapse(section.order)}
                    className="w-full flex items-center justify-between px-5 py-4
                      hover:bg-[var(--color-bg-secondary)] transition-colors duration-[var(--transition)]
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
                  >
                    <span className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text)]">
                      {section.order}. {section.title}
                    </span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                      className={`transform transition-transform duration-[var(--transition)] text-[var(--color-text-secondary)]
                        ${isCollapsed ? '' : 'rotate-180'}`}
                    >
                      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {!isCollapsed && (
                    <div className="px-5 pb-5">
                      <SectionEditor section={section} onChange={handleSectionChange} />
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      ) : (
        <FilesTab projectId={project.id} />
      )}
    </div>
  );
}
