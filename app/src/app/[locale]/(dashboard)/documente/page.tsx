'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Icon } from '@/components/ui/ds-icon';
import { SectionStateBadge } from '@/components/ui/section-state-badge';
import { staggerContainer, staggerItem, staggerTransition } from '@/lib/motion';

/* ---------- types ---------- */
interface WorkspaceProject {
  id: string;
  title: string;
  sectionCount: number;
  stateBreakdown: { draft: number; reviewed: number; approved: number };
  lastEditedAt: string;
  mode: 'session' | 'snapshot';
  hasUploadedFiles: boolean;
}

type StateFilter = 'all' | 'draft' | 'reviewed' | 'approved';

/* ---------- helpers ---------- */
function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/* ---------- page component ---------- */
export default function DocumentsPage() {
  const params = useParams();
  const locale = params.locale as string;
  const t = useTranslations('workspace');
  const te = useTranslations('sectionEditor');
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StateFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/v1/workspace');
        if (res.ok) {
          const data = await res.json();
          setProjects(data.projects);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = projects.filter((p) => {
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'all') return true;
    return p.stateBreakdown[filter] > 0;
  });

  const FILTERS: { key: StateFilter; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'draft', label: t('filterDraft') },
    { key: 'reviewed', label: t('filterReviewed') },
    { key: 'approved', label: t('filterApproved') },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-on-surface mb-2">{t('title')}</h1>
        <p className="text-lg text-on-surface-variant">{t('subtitle')}</p>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Icon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('title') + '...'}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-outline-variant/20 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/40 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                filter === key
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Generated Documents */}
      <div className="mb-12">
        <h2 className="text-lg font-semibold text-on-surface mb-6">{t('generatedDocuments')}</h2>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse bg-surface-container rounded-xl h-40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="article" size="lg" className="text-on-surface-variant/30 mx-auto mb-4" />
            <p className="text-on-surface-variant">{t('noProjects')}</p>
          </div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {filtered.map((p) => (
              <motion.div
                key={p.id}
                variants={staggerItem}
                transition={staggerTransition}
                className="bg-surface border border-outline-variant/15 rounded-xl p-6 hover:border-outline-variant/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h3 className="text-base font-semibold text-on-surface line-clamp-1">{p.title}</h3>
                  <a
                    href={`/api/v1/projects/${p.id}/export?format=docx`}
                    className="shrink-0 p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors"
                    title={te('exportDocx')}
                  >
                    <Icon name="download" size="sm" />
                  </a>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm text-on-surface-variant">
                    {te('sectionCount', { count: p.sectionCount })}
                  </span>
                  {p.stateBreakdown.draft > 0 && <SectionStateBadge state="draft" />}
                  {p.stateBreakdown.reviewed > 0 && <SectionStateBadge state="reviewed" />}
                  {p.stateBreakdown.approved > 0 && <SectionStateBadge state="approved" />}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant">
                    {te('lastEdited', { time: formatRelativeTime(p.lastEditedAt) })}
                  </span>
                  <a
                    href={`/${locale}/proiecte/${p.id}?tab=sections`}
                    className="flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    {t('openWorkspace')}
                    <Icon name="arrow_forward" size="sm" />
                  </a>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Uploaded Files section */}
      {projects.some((p) => p.hasUploadedFiles) && (
        <div>
          <h2 className="text-lg font-semibold text-on-surface mb-6">{t('uploadedFiles')}</h2>
          <p className="text-sm text-on-surface-variant">
            {t('uploadedFiles')} — {t('uploadedFilesHint')}
          </p>
        </div>
      )}
    </motion.div>
  );
}
