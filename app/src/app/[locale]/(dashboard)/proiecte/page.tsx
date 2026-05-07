'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Icon } from '@/components/ui/ds-icon';
import { relativeTime } from '@/lib/utils';
import { staggerContainer, staggerItem, staggerTransition } from '@/lib/motion';
import { csrfFetch } from '@/lib/csrf/client';

/* ---------- types ---------- */
type ProjectStatus = 'in_progress' | 'submitted' | 'approved' | 'draft';

interface ApiProject {
  id: string;
  title: string;
  status: string; // 'ciorna' | 'in_lucru' | 'verificare' | 'aprobat' | 'finalizat'
  totalBudget: number | null;
  complianceScore: number | null;
  matchScore: number | null;
  createdAt: string;
  updatedAt: string;
  orgId: string;
  acronym: string | null;
}

/* ---------- status mapping ---------- */
const STATUS_MAP: Record<string, ProjectStatus> = {
  ciorna: 'draft',
  in_lucru: 'in_progress',
  verificare: 'submitted',
  aprobat: 'approved',
  finalizat: 'approved',
};

/* ---------- status styling ---------- */
const STATUS_STYLES: Record<ProjectStatus, { bg: string; text: string; ring: string }> = {
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', ring: 'stroke-primary' },
  submitted: { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'stroke-amber-500' },
  approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'stroke-emerald-500' },
  draft: { bg: 'bg-slate-200', text: 'text-slate-900', ring: 'stroke-slate-400' },
};

/* ---------- progress ring ---------- */
function ProgressRing({
  progress,
  status,
}: {
  progress: number;
  status: ProjectStatus;
}) {
  const style = STATUS_STYLES[status];
  const isComplete = progress >= 100;

  return (
    <div className="relative w-12 h-12">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
        <circle
          className="stroke-slate-100"
          cx="18"
          cy="18"
          r="16"
          fill="none"
          strokeWidth="3"
        />
        <circle
          className={style.ring}
          cx="18"
          cy="18"
          r="16"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${progress} 100`}
        />
      </svg>
      {isComplete && status === 'submitted' ? (
        <Icon
          name="check"
          size="sm"
          className="absolute inset-0 flex items-center justify-center text-amber-600"
        />
      ) : isComplete && status === 'approved' ? (
        <Icon
          name="verified"
          filled
          size="sm"
          className="absolute inset-0 flex items-center justify-center text-emerald-600"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-on-surface">
          {progress}%
        </span>
      )}
    </div>
  );
}

/* ---------- team avatars ---------- */
function TeamAvatars({ count }: { count: number }) {
  const visible = Math.min(count, 2);
  const overflow = count - visible;
  const colors = ['bg-slate-200', 'bg-slate-300'];

  return (
    <div className="flex -space-x-2">
      {Array.from({ length: visible }).map((_, i) => (
        <div
          key={i}
          className={`w-6 h-6 rounded-full border-2 border-white ${colors[i]} flex items-center justify-center`}
        >
          <Icon name="person" size="sm" className="text-black text-[10px]" />
        </div>
      ))}
      {overflow > 0 && (
        <div className="w-6 h-6 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[8px] font-bold">
          +{overflow}
        </div>
      )}
    </div>
  );
}

/* ---------- loading skeleton card ---------- */
function SkeletonCard() {
  return (
    <div className="glass-card p-8 flex flex-col animate-pulse min-h-[200px]">
      <div className="flex justify-between items-start mb-6">
        <div className="h-5 w-20 rounded-full bg-slate-200" />
        <div className="w-12 h-12 rounded-full bg-slate-200" />
      </div>
      <div className="h-6 w-3/4 rounded bg-slate-200 mb-2" />
      <div className="h-4 w-1/2 rounded bg-slate-100 mb-8" />
      <div className="mt-auto flex items-center justify-between">
        <div className="flex -space-x-2">
          <div className="w-6 h-6 rounded-full bg-slate-200 border-2 border-white" />
        </div>
        <div className="h-3 w-16 rounded bg-slate-100" />
      </div>
    </div>
  );
}

/* ---------- filter chips ---------- */
const FILTERS = ['all', 'in_progress', 'submitted', 'approved'] as const;
type FilterKey = (typeof FILTERS)[number];

/* ---------- page component ---------- */
export default function ProiectePage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const t = useTranslations('projects');
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [page] = useState(1);
  const hiddenProjectIdsRef = useRef<Set<string>>(new Set());
  const deletingIdsRef = useRef<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());

  const searchTimeoutRef = useRef<NodeJS.Timeout>();

  const handleSearchChange = (value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setSearch(value), 300);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), perPage: '12' });
    if (search) params.set('search', search);
    if (statusFilter !== 'all') {
      const statusMap: Record<string, string> = {
        draft: 'ciorna',
        in_progress: 'in_lucru',
        submitted: 'verificare',
        approved: 'aprobat',
      };
      params.set('status', statusMap[statusFilter] || statusFilter);
    }
    fetch(`/api/v1/projects?${params}`)
      .then((res) => res.json())
      .then((data) => {
        const hiddenIds = hiddenProjectIdsRef.current;
        const items = data.data?.items || [];
        setProjects(items.filter((project: ApiProject) => !hiddenIds.has(project.id)));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [page, search, statusFilter]);

  const setProjectDeleting = (projectId: string, deleting: boolean) => {
    const next = new Set(deletingIdsRef.current);
    if (deleting) {
      next.add(projectId);
    } else {
      next.delete(projectId);
    }
    deletingIdsRef.current = next;
    setDeletingIds(next);
  };

  const handleDelete = async (project: ApiProject, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (deletingIdsRef.current.has(project.id)) return;
    const confirmed = window.confirm(
      t('deleteConfirm', { title: project.title || t('untitled') })
    );
    if (!confirmed) return;
    hiddenProjectIdsRef.current.add(project.id);
    setProjectDeleting(project.id, true);
    setProjects((list) => list.filter((p) => p.id !== project.id));
    try {
      const res = await csrfFetch(`/api/v1/projects/${project.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      hiddenProjectIdsRef.current.delete(project.id);
      setProjects((list) => {
        if (list.some((item) => item.id === project.id)) return list;
        return [project, ...list];
      });
      window.alert(t('deleteFailed'));
    } finally {
      setProjectDeleting(project.id, false);
    }
  };

  return (
    <main className="flex-1 px-12 py-10 max-w-7xl mx-auto">
      {/* Header Section */}
      <header className="mb-16">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="text-5xl font-bold tracking-tight text-on-surface mb-2">
              {t('pageTitle')}
            </h2>
            <p className="text-on-surface-variant text-lg">
              {t('pageSubtitle')}
            </p>
          </div>
          <Link
            href={`/${locale}/proiecte/nou`}
            className="bg-primary-container text-white px-8 py-4 rounded-full font-semibold hover:-translate-y-px transition-all flex items-center space-x-2"
          >
            <Icon name="add" />
            <span>{t('createProject')}</span>
          </Link>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col md:flex-row gap-6 items-center">
          <div className="relative flex-1 w-full">
            <Icon
              name="search"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              className="w-full pl-12 pr-4 py-4 bg-surface-container-high border-none rounded-full focus:ring-2 focus:ring-primary/20 transition-all text-on-surface placeholder:text-on-surface-variant/70"
              placeholder={t('searchPlaceholder')}
              type="text"
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 w-full md:w-auto">
            {FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`px-6 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  statusFilter === filter
                    ? 'bg-on-surface text-surface'
                    : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                }`}
              >
                {t(`filterChips.${filter}`)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Error state */}
      {error && !loading && (
        <div className="text-center py-10 text-red-600">
          <p>{t('errorLoading')}: {error}</p>
        </div>
      )}

      {/* Projects Grid */}
      <motion.section
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-24"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* Loading skeletons */}
        {loading &&
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}

        {/* Empty state */}
        {!loading && !error && projects.length === 0 && (
          <div className="col-span-full text-center py-20">
            <Icon name="folder_open" size="lg" className="text-on-surface-variant mb-4" />
            <h3 className="text-lg font-semibold text-on-surface">{t('emptyTitle')}</h3>
            <p className="text-on-surface-variant mt-2">{t('emptyDescription')}</p>
            <Link
              href={`/${locale}/proiecte/nou`}
              className="mt-6 inline-flex bg-primary-container text-white px-8 py-4 rounded-full font-semibold hover:-translate-y-px transition-all"
            >
              {t('startFirstProject')}
            </Link>
          </div>
        )}

        {/* Project cards */}
        {!loading &&
          projects.map((project) => {
            const uiStatus: ProjectStatus = STATUS_MAP[project.status] ?? 'draft';
            const style = STATUS_STYLES[uiStatus];
            const progress = project.complianceScore || 0;
            return (
              <motion.div
                key={project.id}
                variants={staggerItem}
                transition={staggerTransition}
                className="relative h-full group"
              >
                <button
                  type="button"
                  onClick={(e) => handleDelete(project, e)}
                  disabled={deletingIds.has(project.id)}
                  aria-label={t('delete')}
                  title={t('delete')}
                  className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/80 backdrop-blur hover:bg-red-50 hover:text-red-600 text-on-surface-variant flex items-center justify-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus:opacity-100 focus:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto transition-opacity shadow-sm disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Icon name="delete" size="sm" />
                </button>
                <Link
                  href={`/${locale}/proiecte/${project.id}`}
                  className="glass-card p-8 flex flex-col hover:shadow-[0_20px_40px_rgba(0,0,0,0.04)] transition-all cursor-pointer group h-full"
                >
                  {/* Status + Progress */}
                  <div className="flex justify-between items-start mb-6">
                    <span
                      className={`${style.bg} ${style.text} px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase`}
                    >
                      {t(`statusLabels.${uiStatus}`)}
                    </span>
                    <ProgressRing progress={progress} status={uiStatus} />
                  </div>

                  {/* Title */}
                  <h3 className="text-xl font-bold text-on-surface leading-tight mb-2 group-hover:text-primary transition-colors">
                    {project.title}
                  </h3>
                  <p className="text-on-surface-variant text-sm mb-8">
                    {project.acronym || ''} &bull; ID: {project.id.slice(0, 8)}
                  </p>

                  {/* Footer */}
                  <div className="mt-auto flex items-center justify-between">
                    <TeamAvatars count={1} />
                    <p className="text-[10px] text-on-surface-variant font-medium uppercase">
                      {t('modified')} {relativeTime(project.updatedAt)}
                    </p>
                  </div>
                </Link>
              </motion.div>
            );
          })}

        {/* Ghost "add" card — always last when not loading */}
        {!loading && (
          <motion.div variants={staggerItem} transition={staggerTransition}>
            <Link
              href={`/${locale}/proiecte/nou`}
              className="flex items-center justify-center border-2 border-dashed border-outline-variant/30 rounded-[1.5rem] min-h-[200px] hover:border-primary/30 transition-colors"
            >
              <Icon name="add" size="lg" className="text-on-surface-variant" />
            </Link>
          </motion.div>
        )}
      </motion.section>

      {/* Archive Section */}
      <section className="max-w-4xl mx-auto py-24 text-center">
        <div className="relative inline-block mb-10">
          <div className="absolute inset-0 bg-secondary/10 blur-[80px] rounded-full scale-150" />
          <div className="relative glass-card w-64 h-64 flex flex-col items-center justify-center mx-auto">
            <Icon name="inventory_2" size="lg" className="text-on-surface-variant mb-4" />
            <p className="text-on-surface-variant font-medium text-sm">
              {t('archiveEmpty')}
            </p>
          </div>
        </div>
        <h4 className="text-3xl font-bold mb-4">{t('archiveTitle')}</h4>
        <p className="text-on-surface-variant max-w-md mx-auto mb-10 leading-relaxed">
          {t('archiveDescription')}
        </p>
        <button className="text-primary font-bold hover:underline transition-all">
          {t('archiveLearnMore')}
        </button>
      </section>
    </main>
  );
}
