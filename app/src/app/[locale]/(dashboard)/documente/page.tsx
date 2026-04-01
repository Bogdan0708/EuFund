'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Icon } from '@/components/ui/ds-icon';
import { staggerContainer, staggerItem, staggerTransition } from '@/lib/motion';

/* ---------- types ---------- */
type FileFilter = 'all' | 'recent' | 'shared' | 'archived';

interface AggregatedFile {
  id: string;
  name: string;
  size: number | null;
  mimeType: string;
  projectId: string;
  projectTitle: string;
  source: 'uploaded' | 'generated';
  createdAt: string;
  updatedAt: string;
}

/* ---------- constants ---------- */
const FILTER_OPTIONS: FileFilter[] = ['all', 'recent', 'shared', 'archived'];

const SMART_TEMPLATES = [
  { iconName: 'article', labelKey: 'templateExecutiveSummary' },
  { iconName: 'pie_chart', labelKey: 'templateBudgetPlanner' },
  { iconName: 'timeline', labelKey: 'templateProjectRoadmap' },
];

const COMPLIANCE_FILES = [
  {
    icon: 'verified_user',
    name: 'GDPR_Audit_Q3.pdf',
    meta: 'Regulatory • 4.5 MB',
    status: 'verified' as const,
  },
  {
    icon: 'policy',
    name: 'Ethics_Framework_2024.pdf',
    meta: 'Internal • 1.2 MB',
    status: 'pending' as const,
  },
];

/* ---------- helpers ---------- */
function getFileIcon(mimeType: string): { name: string; bg: string; color: string } {
  if (mimeType.includes('pdf')) return { name: 'picture_as_pdf', bg: 'bg-red-50', color: 'text-red-500' };
  if (mimeType.includes('word') || mimeType.includes('docx') || mimeType.includes('msword'))
    return { name: 'description', bg: 'bg-blue-50', color: 'text-blue-500' };
  if (mimeType.includes('sheet') || mimeType.includes('xlsx') || mimeType.includes('excel'))
    return { name: 'table_chart', bg: 'bg-green-50', color: 'text-green-500' };
  return { name: 'folder_zip', bg: 'bg-amber-50', color: 'text-amber-600' };
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/* ---------- skeleton component ---------- */
function FileSkeleton() {
  return (
    <div className="glass-card p-6 rounded-lg border border-white/20 shadow-[0_20px_40px_rgba(0,0,0,0.04)] animate-pulse">
      <div className="flex justify-between items-start mb-6">
        <div className="w-12 h-12 bg-surface-container-highest rounded-xl" />
        <div className="w-6 h-6 bg-surface-container-highest rounded" />
      </div>
      <div className="h-5 bg-surface-container-highest rounded mb-2 w-3/4" />
      <div className="h-4 bg-surface-container-highest rounded mb-6 w-1/2" />
      <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
        <div className="w-6 h-6 rounded-full bg-surface-container-highest" />
        <div className="h-3 bg-surface-container-highest rounded w-1/3" />
      </div>
    </div>
  );
}

/* ---------- file card component ---------- */
function FileCard({ file }: { file: AggregatedFile }) {
  const t = useTranslations('files');
  const icon = getFileIcon(file.mimeType);
  const isGenerated = file.source === 'generated';

  return (
    <motion.div
      variants={staggerItem}
      transition={staggerTransition}
      className="glass-card p-6 rounded-lg border border-white/20 shadow-[0_20px_40px_rgba(0,0,0,0.04)] hover:translate-y-[-4px] transition-all duration-300 group"
    >
      <div className="flex justify-between items-start mb-6">
        <div className={`w-12 h-12 ${icon.bg} ${icon.color} rounded-xl flex items-center justify-center`}>
          <Icon name={icon.name} size="lg" />
        </div>
        <button className="text-on-surface-variant/40 hover:text-on-surface transition-colors">
          <Icon name="more_vert" />
        </button>
      </div>
      <h4 className="font-bold text-on-surface text-lg mb-1 truncate">{file.name}</h4>
      <p className="text-sm text-on-surface-variant mb-6">
        {formatBytes(file.size)} &bull; {t('updatedAgo', { time: formatRelativeTime(file.updatedAt) })}
      </p>
      <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
        {isGenerated ? (
          <>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              <Icon name="auto_awesome" size="sm" />
              AI
            </span>
            <span className="text-[10px] text-on-surface-variant">{file.projectTitle}</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-highest text-[10px] font-semibold text-on-surface-variant">
            {file.projectTitle}
          </span>
        )}
      </div>
    </motion.div>
  );
}

/* ---------- page component ---------- */
export default function DocumentePage() {
  const t = useTranslations('files');
  const [activeFilter, setActiveFilter] = useState<FileFilter>('all');
  const [files, setFiles] = useState<AggregatedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const projRes = await fetch('/api/v1/projects?perPage=50');
        const projData = await projRes.json();
        const projects = projData.data?.items || [];

        const allFiles: AggregatedFile[] = [];

        // Fetch files for each project (limit to first 10 projects to avoid too many requests)
        const projectsToFetch = projects.slice(0, 10);
        await Promise.all(
          projectsToFetch.map(async (project: { id: string; title: string }) => {
            try {
              const filesRes = await fetch(`/api/v1/projects/${project.id}/files`);
              if (!filesRes.ok) return;
              const filesData = await filesRes.json();
              const projectFiles = filesData.data || filesData.files || [];
              for (const file of projectFiles) {
                allFiles.push({
                  id: file.id,
                  name: file.filename || file.name,
                  size: file.sizeBytes || file.size || null,
                  mimeType: file.mimeType || 'application/octet-stream',
                  projectId: project.id,
                  projectTitle: project.title,
                  source: file.source || 'uploaded',
                  createdAt: file.createdAt,
                  updatedAt: file.updatedAt || file.createdAt,
                });
              }
            } catch {
              // Skip projects with no files endpoint
            }
          })
        );

        setFiles(allFiles);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorLoading'));
        setLoading(false);
      }
    })();
  }, [t]);

  const filteredFiles = files
    .filter((f) => {
      if (activeFilter === 'recent') {
        return Date.now() - new Date(f.updatedAt).getTime() < 7 * 24 * 60 * 60 * 1000;
      }
      if (activeFilter !== 'all')
        return f.projectTitle.toLowerCase().includes(activeFilter.toLowerCase());
      return true;
    })
    .filter((f) => {
      if (!searchQuery) return true;
      return f.name.toLowerCase().includes(searchQuery.toLowerCase());
    });

  const uploadedFiles = filteredFiles.filter((f) => f.source === 'uploaded');
  const generatedFiles = filteredFiles.filter((f) => f.source === 'generated');

  return (
    <div className="fade-in-up max-w-[1200px] mx-auto">
      {/* ── Header Section ── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
        <div className="space-y-2">
          <h2 className="text-[56px] font-bold tracking-tighter leading-none text-on-surface">
            {t('pageTitle')}
          </h2>
          <p className="text-lg text-on-surface-variant font-medium">
            {t('pageSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Icon
              name="search"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50"
            />
            <input
              className="pl-12 pr-6 py-3 bg-surface-container-high rounded-full border-none focus:ring-2 focus:ring-primary/20 transition-all w-64 text-sm font-medium"
              placeholder={t('searchPlaceholder')}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            disabled
            title={t('comingSoon')}
            className="bg-[#0071e3] text-white px-8 py-3 rounded-full font-semibold flex items-center gap-2 hover:translate-y-[-1px] transition-transform shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon name="upload" />
            <span>{t('upload')}</span>
          </button>
        </div>
      </header>

      {/* ── Filter Chips ── */}
      <div className="flex gap-3 mb-12">
        {FILTER_OPTIONS.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
              activeFilter === filter
                ? 'bg-on-surface text-surface'
                : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            {t(`filter.${filter}`)}
          </button>
        ))}
      </div>

      {/* ── Error state ── */}
      {error && (
        <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-medium">
          {error}
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <section className="mb-20">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold tracking-tight">{t('projectDocuments')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FileSkeleton />
            <FileSkeleton />
            <FileSkeleton />
          </div>
        </section>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && filteredFiles.length === 0 && (
        <section className="mb-20">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-surface-container-highest rounded-2xl flex items-center justify-center mb-6">
              <Icon name="folder_open" size="lg" className="text-on-surface-variant/50" />
            </div>
            <h3 className="text-xl font-bold text-on-surface mb-2">{t('noFilesTitle')}</h3>
            <p className="text-on-surface-variant text-sm max-w-md leading-relaxed">
              {t('noFilesDescription')}
            </p>
          </div>
        </section>
      )}

      {/* ── Section: Project Documents (uploaded) ── */}
      {!loading && !error && uploadedFiles.length > 0 && (
        <section className="mb-20">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold tracking-tight">{t('projectDocuments')}</h3>
            <button className="text-primary font-semibold text-sm flex items-center hover:opacity-80 transition-opacity">
              {t('viewAll')}{' '}
              <Icon name="chevron_right" size="sm" className="ml-1" />
            </button>
          </div>
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {uploadedFiles.map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </motion.div>
        </section>
      )}

      {/* ── Section: Generated Documents ── */}
      {!loading && !error && generatedFiles.length > 0 && (
        <section className="mb-20">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold tracking-tight">{t('generated')}</h3>
          </div>
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {generatedFiles.map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </motion.div>
        </section>
      )}

      {/* ── Section: Compliance & Smart Templates (12-col bento) ── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-20">
        {/* Compliance — Left 8 cols */}
        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold tracking-tight">{t('compliance')}</h3>
          </div>
          <div className="space-y-4">
            {COMPLIANCE_FILES.map((cf) => (
              <div
                key={cf.name}
                className="glass-card p-4 rounded-lg flex items-center justify-between hover:bg-white transition-colors"
              >
                <div className="flex items-center gap-4">
                  <Icon name={cf.icon} className="text-tertiary-container" />
                  <div>
                    <p className="font-semibold text-sm">{cf.name}</p>
                    <p className="text-xs text-on-surface-variant">{cf.meta}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  {cf.status === 'verified' ? (
                    <span className="px-3 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">
                      {t('status.verified')}
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">
                      {t('status.pending')}
                    </span>
                  )}
                  <button className="text-on-surface-variant/40 hover:text-on-surface transition-colors">
                    <Icon name="download" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Smart Templates — Right 4 cols */}
        <div className="lg:col-span-4 mt-12 lg:mt-0">
          <div className="bg-primary-container p-8 rounded-lg text-white h-full relative overflow-hidden group">
            {/* Subtle mesh background */}
            <div className="absolute inset-0 opacity-20 pointer-events-none bg-gradient-to-br from-white to-transparent" />
            <div className="relative z-10">
              <Icon name="auto_awesome" size="lg" className="mb-4" />
              <h3 className="text-2xl font-bold mb-2">{t('smartTemplatesTitle')}</h3>
              <p className="text-white/80 text-sm mb-8 leading-relaxed">
                {t('smartTemplatesDescription')}
              </p>
              <ul className="space-y-3 mb-8">
                {SMART_TEMPLATES.map((tmpl) => (
                  <li
                    key={tmpl.labelKey}
                    className="flex items-center gap-2 text-xs font-medium bg-white/10 p-2 rounded-lg"
                  >
                    <Icon name={tmpl.iconName} size="sm" /> {t(tmpl.labelKey)}
                  </li>
                ))}
              </ul>
              <button
                disabled
                title={t('comingSoon')}
                className="w-full bg-white text-primary py-3 rounded-full font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                {t('browseTemplates')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
