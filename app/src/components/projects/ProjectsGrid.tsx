'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProjectCard, type Project } from './ProjectCard';
import { ProjectDetail } from './ProjectDetail';

interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

const statusFilters = [
  { value: 'all', labelRo: 'Toate', labelEn: 'All' },
  { value: 'ciorna', labelRo: 'Ciorne', labelEn: 'Drafts' },
  { value: 'in_lucru', labelRo: 'In lucru', labelEn: 'In progress' },
  { value: 'verificare', labelRo: 'In verificare', labelEn: 'In review' },
  { value: 'depus', labelRo: 'Depuse', labelEn: 'Submitted' },
  { value: 'aprobat', labelRo: 'Aprobate', labelEn: 'Approved' },
] as const;

export function ProjectsGrid() {
  const locale = useLocale();
  const [items, setItems] = useState<Project[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams();
      query.set('page', String(page));
      query.set('perPage', '12');
      if (search.trim()) query.set('search', search.trim());
      if (statusFilter !== 'all') query.set('status', statusFilter);

      const res = await fetch(`/api/v1/projects?${query.toString()}`);
      if (!res.ok) {
        throw new Error(locale === 'ro' ? 'Nu s-au putut incarca proiectele.' : 'Failed to load projects.');
      }
      const payload = await res.json();
      setItems(payload?.data?.items || []);
      setMeta(payload?.data?.meta || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : (locale === 'ro' ? 'Eroare neasteptata.' : 'Unexpected error.'));
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, locale]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  // Project detail view
  if (selectedProject) {
    return (
      <ProjectDetail
        project={selectedProject}
        onBack={() => setSelectedProject(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[var(--font-size-2xl)] font-semibold text-[var(--color-text)]">
          {locale === 'ro' ? 'Proiecte' : 'Projects'}
        </h1>
        <p className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
          {locale === 'ro'
            ? 'Gestioneaza aplicatiile si proiectele tale.'
            : 'Manage your applications and projects.'}
        </p>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={locale === 'ro' ? 'Cauta proiecte...' : 'Search projects...'}
          className="sm:max-w-xs rounded-[var(--radius-sm)] border-[var(--color-border)]"
          aria-label={locale === 'ro' ? 'Cauta proiecte' : 'Search projects'}
        />
        <div className="flex flex-wrap gap-1.5">
          {statusFilters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-[var(--radius-full)] px-3 py-1.5 text-[var(--font-size-xs)] font-medium
                transition-all duration-[var(--transition)] border
                ${statusFilter === f.value
                  ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                  : 'bg-[var(--color-bg)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
                }`}
            >
              {locale === 'ro' ? f.labelRo : f.labelEn}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-[var(--radius-md)] border border-[var(--color-border)]
                bg-[var(--color-bg-secondary)] h-40"
            />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[var(--font-size-sm)] text-[var(--color-error)] mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchProjects}>
            {locale === 'ro' ? 'Reincearca' : 'Retry'}
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)]
            flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5V19M5 12H19" stroke="var(--color-text-secondary)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h3 className="text-[var(--font-size-base)] font-semibold text-[var(--color-text)] mb-1">
            {locale === 'ro' ? 'Niciun proiect inca' : 'No projects yet'}
          </h3>
          <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
            {locale === 'ro'
              ? 'Creeaza un proiect nou pentru a incepe.'
              : 'Create a new project to get started.'}
          </p>
        </div>
      )}

      {/* Grid */}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={setSelectedProject}
              />
            ))}
          </div>

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                {locale === 'ro'
                  ? `${items.length} din ${meta.total} proiecte`
                  : `${items.length} of ${meta.total} projects`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {locale === 'ro' ? 'Anterior' : 'Previous'}
                </Button>
                <span className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                  {page} / {meta.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                >
                  {locale === 'ro' ? 'Urmator' : 'Next'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
