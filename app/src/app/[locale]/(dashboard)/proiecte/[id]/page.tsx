'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Tabs from '@radix-ui/react-tabs';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '@/components/ui/ds-icon';
import { pageVariants, pageTransition } from '@/lib/motion';
import { csrfFetch, bootstrapCSRFToken } from '@/lib/csrf/client';
import { relativeTime } from '@/lib/utils';
import type { SubmissionDocument } from '@/lib/ai/orchestrator/types';
import { SectionsTabContent } from './components/SectionsTabContent';

/* ---------- types ---------- */
interface ProjectDetail {
  id: string;
  title: string;
  acronym: string | null;
  status: string;
  totalBudget: string | null;
  euContribution: string | null;
  complianceScore: string | null;
  matchScore: string | null;
  durationMonths: number | null;
  sectionSummary: string | null;
  sectionContext: string | null;
  organizationName: string | null;
  createdAt: string;
  updatedAt: string;
  orgId: string;
}

interface ProjectFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  category: string;
  description: string | null;
  createdAt: string;
}

interface V3Session {
  id: string;
  projectTitle: string | null;
  currentPhase: string;
  status: string;
  sectionCount: number;
  updatedAt: string;
}

const RESUMABLE_STATUSES = ['active', 'paused', 'error'];

/* ---------- status display map ---------- */
const STATUS_KEYS: Record<string, { labelKey: string; className: string }> = {
  ciorna:      { labelKey: 'statusDraft',       className: 'bg-surface-container text-on-surface-variant' },
  in_lucru:    { labelKey: 'statusInProgress',  className: 'bg-[#0071E3]/10 text-[#0071E3]' },
  verificare:  { labelKey: 'statusUnderReview', className: 'bg-amber-50 text-amber-700' },
  aprobat:     { labelKey: 'statusApproved',    className: 'bg-green-50 text-green-700' },
  finalizat:   { labelKey: 'statusCompleted',   className: 'bg-green-50 text-green-700' },
  draft:       { labelKey: 'statusDraft',       className: 'bg-surface-container text-on-surface-variant' },
  action_plan: { labelKey: 'statusActionPlan',  className: 'bg-amber-50 text-amber-700' },
  built:       { labelKey: 'statusBuilt',       className: 'bg-[#0071E3]/10 text-[#0071E3]' },
  exported:    { labelKey: 'statusExported',    className: 'bg-green-50 text-green-700' },
};

/* ---------- helpers ---------- */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ro-RO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function mimeTypeToIcon(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'picture_as_pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'table_chart';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'description';
  if (mimeType.startsWith('image/')) return 'image';
  return 'attach_file';
}

function formatBudget(val: string | null): string {
  if (!val) return '—';
  const num = parseFloat(val);
  if (isNaN(num)) return '—';
  if (num >= 1_000_000) return `€${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `€${(num / 1_000).toFixed(0)}K`;
  return `€${num.toFixed(0)}`;
}

/* ---------- large progress ring ---------- */
function LargeProgressRing({ progress, label }: { progress: number; label: string }) {
  const circumference = 2 * Math.PI * 70;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative w-40 h-40 mb-8">
      <svg className="w-full h-full -rotate-90">
        <circle cx="80" cy="80" r="70" fill="none" stroke="#F4F3F8" strokeWidth="12" />
        <circle
          cx="80"
          cy="80"
          r="70"
          fill="none"
          stroke="#0071E3"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-extrabold text-on-surface">{progress}%</span>
        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
          {label}
        </span>
      </div>
    </div>
  );
}

/* ---------- tab trigger styling ---------- */
function TabTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="pb-4 text-lg font-medium text-on-surface-variant hover:text-on-surface transition-colors data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:border-b-2 data-[state=active]:border-primary"
    >
      {children}
    </Tabs.Trigger>
  );
}

/* ---------- skeleton ---------- */
function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-surface-container rounded-xl ${className ?? ''}`} />;
}

function PageSkeleton() {
  return (
    <div className="max-w-7xl mx-auto">
      <SkeletonBlock className="h-4 w-32 mb-8" />
      <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-16">
        <div className="space-y-4 max-w-3xl w-full">
          <SkeletonBlock className="h-6 w-24" />
          <SkeletonBlock className="h-12 w-3/4" />
        </div>
        <div className="flex gap-3">
          <SkeletonBlock className="h-10 w-24" />
          <SkeletonBlock className="h-10 w-32" />
        </div>
      </div>
      <div className="flex gap-10 mb-12 border-b border-outline-variant/15 pb-4">
        {['w-20', 'w-24', 'w-16', 'w-24'].map((w, i) => (
          <SkeletonBlock key={i} className={`h-5 ${w}`} />
        ))}
      </div>
      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-8 space-y-8">
          <SkeletonBlock className="h-64" />
          <SkeletonBlock className="h-40" />
        </div>
        <div className="col-span-12 lg:col-span-4 space-y-8">
          <SkeletonBlock className="h-72" />
          <SkeletonBlock className="h-48" />
        </div>
      </div>
    </div>
  );
}

/* ---------- documents tab content ---------- */
function DocumentsTabContent({
  files,
  submissionDocs,
  setSubmissionDocs,
  projectId,
  td,
  t,
}: {
  files: ProjectFile[];
  submissionDocs: SubmissionDocument[];
  setSubmissionDocs: React.Dispatch<React.SetStateAction<SubmissionDocument[]>>;
  projectId: string;
  td: ReturnType<typeof useTranslations>;
  t: ReturnType<typeof useTranslations>;
}) {
  const proposalFiles = files.filter(f => f.storagePath?.includes('/propunere/'));
  const formFiles = files.filter(f => f.storagePath?.includes('/formulare/'));
  const uploadedFiles = files.filter(
    f => !f.storagePath?.includes('/propunere/') && !f.storagePath?.includes('/formulare/')
  );

  return (
    <div className="space-y-8">
      {/* Propunere */}
      <div>
        <h3 className="text-lg font-bold mb-4">{td('propunere')}</h3>
        {proposalFiles.length === 0 ? (
          <p className="text-sm text-on-surface-variant">{td('noFiles')}</p>
        ) : (
          <div className="space-y-2">
            {proposalFiles
              .sort((a, b) => a.filename.localeCompare(b.filename))
              .map(file => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/10"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="description" size="sm" className="text-primary" />
                    <span className="text-sm font-medium text-on-surface">
                      {file.filename.replace('.docx', '').replace(/^\d+-/, '')}
                    </span>
                  </div>
                  <a
                    href={`/api/v1/projects/${projectId}/files/${file.id}`}
                    className="px-3 py-1 text-xs font-bold rounded-full bg-primary-fixed text-primary hover:bg-primary-fixed/80 transition-colors"
                  >
                    {td('download')}
                  </a>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Dosar de depunere */}
      <div>
        <h3 className="text-lg font-bold mb-2">{td('dosar')}</h3>
        {submissionDocs.length > 0 ? (
          <>
            {/* Progress bar */}
            {(() => {
              const completed = submissionDocs.filter(d => d.userStatus === 'completed').length;
              const total = submissionDocs.length;
              const pct = total > 0 ? (completed / total) * 100 : 0;
              return (
                <div className="mb-4">
                  <p className="text-xs text-on-surface-variant mb-1">
                    {td('progress', { completed, total })}
                  </p>
                  <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Grouped items */}
            {(['needs_fill', 'external_required', 'generated'] as const).map(availability => {
              const group = submissionDocs.filter(
                d => d.availability === availability && d.userStatus !== 'completed'
              );
              if (group.length === 0) return null;
              const label =
                availability === 'needs_fill'
                  ? td('groupNeedsFill')
                  : availability === 'external_required'
                    ? td('groupExternal')
                    : td('groupGenerated');
              return (
                <div key={availability} className="mb-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
                    {label}
                  </h4>
                  <div className="space-y-2">
                    {group.map(doc => {
                      const matchingFile = formFiles.find(
                        f => f.filename === `${doc.id.replace(/^doc-[^-]+-/, '')}.docx` || f.description === doc.title
                      );
                      return (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/10"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-on-surface">{doc.title}</span>
                              <span
                                className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-widest ${
                                  doc.scope === 'general'
                                    ? 'bg-primary-fixed text-primary'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {doc.scope === 'general' ? td('scopeGeneral') : td('scopeCall')}
                              </span>
                              {doc.provenance.reviewRequired && (
                                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-widest bg-amber-100 text-amber-800">
                                  {td('reviewRequired')}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-on-surface-variant mt-1">{doc.instructions}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {matchingFile && (
                              <a
                                href={`/api/v1/projects/${projectId}/files/${matchingFile.id}`}
                                className="px-3 py-1 text-xs font-bold rounded-full bg-primary-fixed text-primary hover:bg-primary-fixed/80 transition-colors"
                              >
                                {td('download')}
                              </a>
                            )}
                            <button
                              onClick={async () => {
                                const res = await csrfFetch(
                                  `/api/v1/projects/${projectId}/submission-documents/${doc.id}`,
                                  {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ userStatus: 'completed' }),
                                  }
                                );
                                if (res.ok) {
                                  setSubmissionDocs(prev =>
                                    prev.map(d =>
                                      d.id === doc.id
                                        ? { ...d, userStatus: 'completed', userStatusAt: new Date().toISOString() }
                                        : d
                                    )
                                  );
                                }
                              }}
                              className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition-colors"
                            >
                              {td('markComplete')}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Completed items */}
            {(() => {
              const completed = submissionDocs.filter(d => d.userStatus === 'completed');
              if (completed.length === 0) return null;
              return (
                <div className="mb-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
                    {td('groupCompleted')}
                  </h4>
                  <div className="space-y-2">
                    {completed.map(doc => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-200/50"
                      >
                        <div className="flex items-center gap-2">
                          <Icon name="check_circle" size="sm" className="text-emerald-600" />
                          <span className="text-sm text-on-surface">{doc.title}</span>
                        </div>
                        <button
                          onClick={async () => {
                            const res = await csrfFetch(
                              `/api/v1/projects/${projectId}/submission-documents/${doc.id}`,
                              {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ userStatus: 'not_started' }),
                              }
                            );
                            if (res.ok) {
                              setSubmissionDocs(prev =>
                                prev.map(d =>
                                  d.id === doc.id
                                    ? { ...d, userStatus: 'not_started', userStatusAt: new Date().toISOString() }
                                    : d
                                )
                              );
                            }
                          }}
                          className="px-3 py-1 text-xs rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
                        >
                          {td('markIncomplete')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          <p className="text-sm text-on-surface-variant">{td('noFiles')}</p>
        )}
      </div>

      {/* Documente incarcate */}
      <div>
        <h3 className="text-lg font-bold mb-4">{td('incarcare')}</h3>
        {uploadedFiles.length === 0 ? (
          <p className="text-sm text-on-surface-variant">{td('noFiles')}</p>
        ) : (
          <div className="space-y-2">
            {uploadedFiles.map(file => (
              <div
                key={file.id}
                className="flex items-center justify-between p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/10"
              >
                <div className="flex items-center gap-3">
                  <Icon name={mimeTypeToIcon(file.mimeType)} size="sm" className="text-on-surface-variant" />
                  <div>
                    <span className="text-sm font-medium text-on-surface">{file.filename}</span>
                    <span className="text-xs text-on-surface-variant ml-2">{formatBytes(file.sizeBytes)}</span>
                  </div>
                </div>
                <a
                  href={`/api/v1/projects/${projectId}/files/${file.id}`}
                  className="px-3 py-1 text-xs font-bold rounded-full bg-primary-fixed text-primary hover:bg-primary-fixed/80 transition-colors"
                >
                  {td('download')}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- page component ---------- */
export default function ProiectDetailPage() {
  const t = useTranslations('projectDetail');
  const td = useTranslations('projectDossier');
  const tSession = useTranslations('session');
  const router = useRouter();
  const params = useParams<{ id: string; locale: string }>();
  const id = params.id;
  const locale = params.locale || 'ro';

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [submissionDocs, setSubmissionDocs] = useState<SubmissionDocument[]>([]);
  const [aiSessionId, setAiSessionId] = useState<string | null>(null);
  const [projectSessions, setProjectSessions] = useState<V3Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab') ?? 'overview';
  const [activeTab, setActiveTab] = useState(tabParam);

  useEffect(() => {
    setActiveTab(tabParam);
  }, [tabParam]);

  // Bootstrap CSRF token on mount
  useEffect(() => { bootstrapCSRFToken(); }, []);

  // Fetch project details + extract submission docs from same response
  useEffect(() => {
    fetch(`/api/v1/projects/${id}`)
      .then(res => {
        if (!res.ok) throw new Error('Project not found');
        return res.json();
      })
      .then(data => {
        const p = data.data || data;
        setProject(p);
        const docs = p?.metadata?.submissionDocuments ?? [];
        setSubmissionDocs(docs);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  // Fetch files and AI sessions in parallel once project loads
  useEffect(() => {
    if (!project) return;
    setFilesLoading(true);
    Promise.all([
      fetch(`/api/v1/projects/${id}/files`).then(r => r.ok ? r.json() : { files: [] }).catch(() => ({ files: [] })),
      csrfFetch(`/api/ai/agent/sessions?projectId=${id}`).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
    ]).then(([filesData, sessionsData]) => {
      setFiles(filesData.files ?? []);
      const v3Sessions: V3Session[] = sessionsData.data ?? [];
      setProjectSessions(v3Sessions);
      setAiSessionId(v3Sessions.find(s => RESUMABLE_STATUSES.includes(s.status))?.id ?? null);
    }).finally(() => setFilesLoading(false));
  }, [id, project]);

  if (loading) return <PageSkeleton />;

  if (error || !project) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center py-32 gap-6">
        <Icon name="error_outline" size="lg" className="text-error" />
        <h2 className="text-2xl font-bold text-on-surface">{t('projectNotFound')}</h2>
        <button
          onClick={() => router.push(`/${locale}/proiecte`)}
          className="flex items-center gap-2 px-5 py-3 rounded-full border border-outline-variant/30 text-on-surface font-semibold text-sm hover:bg-surface-container-high transition-colors"
        >
          <Icon name="arrow_back" size="sm" />
          <span>{t('backToProjects')}</span>
        </button>
      </div>
    );
  }

  const statusEntry = STATUS_KEYS[project.status] ?? {
    labelKey: project.status,
    className: 'bg-surface-container text-on-surface-variant',
  };
  const statusLabel = t(statusEntry.labelKey as Parameters<typeof t>[0]);

  const complianceScore = project.complianceScore ? Math.round(parseFloat(project.complianceScore)) : 0;
  const matchScore = project.matchScore ? Math.round(parseFloat(project.matchScore)) : null;

  return (
    <div className="fade-in-up max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-on-surface-variant font-medium text-sm mb-8">
        <button
          onClick={() => router.push(`/${locale}/proiecte`)}
          className="hover:text-primary transition-colors"
        >
          {t('breadcrumb')}
        </button>
        {' / '}
        {project.acronym || project.title.slice(0, 40)}
      </div>

      {/* Hero */}
      <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-16">
        <div className="space-y-4 max-w-3xl">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-4 py-1.5 text-xs font-bold rounded-full uppercase tracking-wider ${statusEntry.className}`}>
              {statusLabel}
            </span>
            {project.acronym && (
              <span className="text-on-surface-variant text-sm font-medium">
                {project.acronym}
              </span>
            )}
          </div>
          <h2 className="text-5xl font-bold tracking-tight text-on-surface leading-tight">
            {project.title}
          </h2>
          {project.organizationName && (
            <p className="text-on-surface-variant text-sm font-medium">
              {project.organizationName}
            </p>
          )}
        </div>
        <div className="flex gap-3 shrink-0">
          <button className="flex items-center gap-2 px-5 py-3 rounded-full border border-outline-variant/30 text-on-surface font-semibold text-sm hover:bg-surface-container-high transition-colors">
            <Icon name="share" size="sm" />
            <span>{t('share')}</span>
          </button>
          {aiSessionId ? (
            <button
              onClick={() => router.push(`/${locale}/asistent-ai?session=${aiSessionId}`)}
              className="flex items-center gap-2 px-5 py-3 rounded-full bg-on-surface text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <Icon name="smart_toy" size="sm" />
              <span>{t('resumeAI')}</span>
            </button>
          ) : (
            <button
              onClick={() => router.push(`/${locale}/asistent-ai`)}
              className="flex items-center gap-2 px-5 py-3 rounded-full bg-on-surface text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <Icon name="smart_toy" size="sm" />
              <span>{t('startAI')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List className="flex gap-10 mb-12 border-b border-outline-variant/15">
          <TabTrigger value="overview">{t('tabs.overview')}</TabTrigger>
          <TabTrigger value="sections">{t('tabs.sections')}</TabTrigger>
          <TabTrigger value="documents">{t('tabs.documents')}</TabTrigger>
          <TabTrigger value="tasks">{t('tabs.tasks')}</TabTrigger>
          <TabTrigger value="timeline">{t('tabs.timeline')}</TabTrigger>
        </Tabs.List>

        <AnimatePresence mode="wait">
          {/* ---- Overview Tab ---- */}
          {activeTab === 'overview' && (
            <Tabs.Content value="overview" forceMount asChild>
              <motion.div
                key="overview"
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
              >
                <div className="grid grid-cols-12 gap-8">
                  {/* Main Content */}
                  <div className="col-span-12 lg:col-span-8 space-y-8">
                    {/* Executive Summary */}
                    <div className="glass-card rounded-lg p-10 shadow-[0_20px_40px_rgba(0,0,0,0.04)]">
                      <h3 className="text-2xl font-bold mb-6">{t('executiveSummary')}</h3>
                      {project.sectionSummary ? (
                        <p className="text-on-surface-variant text-lg leading-relaxed mb-8">
                          {project.sectionSummary}
                        </p>
                      ) : project.sectionContext ? (
                        <p className="text-on-surface-variant text-lg leading-relaxed mb-8">
                          {project.sectionContext}
                        </p>
                      ) : (
                        <p className="text-on-surface-variant text-lg leading-relaxed mb-8 italic opacity-60">
                          {t('noSummaryYet')}
                        </p>
                      )}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-8 pt-8 border-t border-outline-variant/10">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant opacity-60 mb-1">
                            {t('grantAllocation')}
                          </p>
                          <p className="text-2xl font-bold text-on-surface">
                            {formatBudget(project.totalBudget)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant opacity-60 mb-1">
                            {t('duration')}
                          </p>
                          <p className="text-2xl font-bold text-on-surface">
                            {project.durationMonths ? `${project.durationMonths} ${t('months')}` : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant opacity-60 mb-1">
                            {t('matchScore')}
                          </p>
                          <p className="text-2xl font-bold text-on-surface">
                            {matchScore !== null ? `${matchScore}%` : '—'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Project Team */}
                    <div className="bg-surface-container-low rounded-lg p-10">
                      <div className="flex justify-between items-center mb-8">
                        <h3 className="text-xl font-bold">{t('projectDetails')}</h3>
                        <button className="text-primary font-bold text-sm hover:opacity-80 transition-opacity">
                          {t('inviteMember')}
                        </button>
                      </div>
                      {/* Metadata grid */}
                      <div className="grid grid-cols-2 gap-6 mb-8">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant opacity-60 mb-1">
                            {t('createdAt')}
                          </p>
                          <p className="font-semibold text-on-surface">{formatDate(project.createdAt)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant opacity-60 mb-1">
                            {t('lastUpdated')}
                          </p>
                          <p className="font-semibold text-on-surface">{formatDate(project.updatedAt)}</p>
                        </div>
                        {project.euContribution && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant opacity-60 mb-1">
                              {t('euContribution')}
                            </p>
                            <p className="font-semibold text-on-surface">{formatBudget(project.euContribution)}</p>
                          </div>
                        )}
                      </div>
                      {/* Team avatars placeholder */}
                      <div className="flex flex-wrap gap-12">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-full bg-primary-fixed ring-4 ring-white shadow-sm flex items-center justify-center">
                            <Icon name="person" className="text-primary" />
                          </div>
                          <span className="text-sm font-bold text-on-surface">
                            {project.organizationName?.slice(0, 8) || 'Admin'}
                          </span>
                        </div>
                        <div className="w-16 h-16 rounded-full border-2 border-dashed border-outline-variant flex items-center justify-center text-outline-variant cursor-pointer hover:border-primary hover:text-primary transition-colors">
                          <Icon name="add" />
                        </div>
                      </div>
                    </div>

                    {/* V3 AI Sessions */}
                    {projectSessions.length > 0 && (
                      <div className="mt-8">
                        <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wider mb-3">
                          AI Sessions
                        </h3>
                        <div className="space-y-2">
                          {projectSessions.map(s => (
                            <div
                              key={s.id}
                              className="flex items-center gap-4 p-4 rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors cursor-pointer"
                              onClick={() => RESUMABLE_STATUSES.includes(s.status)
                                ? router.push(`/${locale}/proiecte/nou?session=${s.id}`)
                                : undefined
                              }
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                    {tSession(`phase.${s.currentPhase}`)}
                                  </span>
                                  <span className="text-[10px] font-medium text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full">
                                    {tSession(`status.${s.status}`)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-xs text-on-surface-variant">
                                  <span>{tSession('sections', { count: s.sectionCount })}</span>
                                  <span>{relativeTime(s.updatedAt)}</span>
                                </div>
                              </div>
                              {RESUMABLE_STATUSES.includes(s.status) && (
                                <span className="text-xs font-semibold text-primary">{tSession('resume')}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sidebar */}
                  <div className="col-span-12 lg:col-span-4 space-y-8">
                    {/* Progress Ring Card */}
                    <div className="bg-white rounded-lg p-10 shadow-sm flex flex-col items-center text-center">
                      <LargeProgressRing progress={complianceScore} label={t('progressComplete')} />
                      <h4 className="text-lg font-bold mb-2">{t('complianceScore')}</h4>
                      <p className="text-on-surface-variant text-sm mb-6">
                        {t('complianceDescription')}
                      </p>
                      {complianceScore === 0 && (
                        <p className="text-xs text-on-surface-variant opacity-60 italic">
                          {t('noComplianceYet')}
                        </p>
                      )}
                      {/* Deadline bar */}
                      <div className="w-full bg-surface-container p-4 rounded-xl flex justify-between items-center mt-2">
                        <div className="flex items-center gap-2">
                          <Icon name="event_upcoming" className="text-primary" size="sm" />
                          <span className="text-sm font-semibold">{t('deadline')}</span>
                        </div>
                        <span className="text-sm font-bold text-on-surface-variant">
                          {project.durationMonths ? `${project.durationMonths}mo` : '—'}
                        </span>
                      </div>
                    </div>

                    {/* AI Insight Card */}
                    <div className="glass-card rounded-lg p-8 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-secondary opacity-10 blur-3xl" />
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-white">
                          <Icon name="smart_toy" filled />
                        </div>
                        <span className="font-bold text-sm">{t('curatorInsights')}</span>
                      </div>
                      <p className="text-sm text-on-surface-variant italic leading-relaxed mb-6">
                        {t('curatorSuggestion')}
                      </p>
                      <button
                        onClick={() => router.push(aiSessionId ? `/asistent-ai?session=${aiSessionId}` : '/asistent-ai')}
                        className="w-full py-3 bg-secondary/10 text-secondary font-bold text-sm rounded-full hover:bg-secondary/20 transition-colors"
                      >
                        {aiSessionId ? t('resumeAI') : t('startAI')}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </Tabs.Content>
          )}

          {/* ---- Sections Tab ---- */}
          {activeTab === 'sections' && (
            <Tabs.Content value="sections" forceMount asChild>
              <motion.div
                key="sections"
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
              >
                <SectionsTabContent projectId={id} />
              </motion.div>
            </Tabs.Content>
          )}

          {/* ---- Documents Tab ---- */}
          {activeTab === 'documents' && (
            <Tabs.Content value="documents" forceMount asChild>
              <motion.div
                key="documents"
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
              >
                {filesLoading ? (
                  <div className="space-y-8">
                    {[1, 2, 3].map(i => (
                      <SkeletonBlock key={i} className="h-24" />
                    ))}
                  </div>
                ) : (
                  <DocumentsTabContent
                    files={files}
                    submissionDocs={submissionDocs}
                    setSubmissionDocs={setSubmissionDocs}
                    projectId={id}
                    td={td}
                    t={t}
                  />
                )}

                {/* Upload area */}
                <div className="mt-8 border-2 border-dashed border-outline-variant/30 rounded-lg p-12 text-center">
                  <Icon name="cloud_upload" size="lg" className="text-primary/40 mx-auto mb-4" />
                  <p className="font-bold text-on-surface mb-1">{t('uploadTitle')}</p>
                  <p className="text-sm text-on-surface-variant">{t('uploadFormats')}</p>
                </div>
              </motion.div>
            </Tabs.Content>
          )}

          {/* ---- Tasks Tab ---- */}
          {activeTab === 'tasks' && (
            <Tabs.Content value="tasks" forceMount asChild>
              <motion.div
                key="tasks"
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
              >
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                  <Icon name="task_alt" size="lg" className="text-on-surface-variant" />
                  <h3 className="text-xl font-bold text-on-surface">{t('noTasks')}</h3>
                  <p className="text-sm text-on-surface-variant text-center max-w-md">
                    {t('tasksPlaceholder')}
                  </p>
                </div>
              </motion.div>
            </Tabs.Content>
          )}

          {/* ---- Timeline Tab ---- */}
          {activeTab === 'timeline' && (
            <Tabs.Content value="timeline" forceMount asChild>
              <motion.div
                key="timeline"
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
              >
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                  <Icon name="timeline" size="lg" className="text-on-surface-variant" />
                  <h3 className="text-xl font-bold text-on-surface">{t('timelinePlaceholder')}</h3>
                  <p className="text-sm text-on-surface-variant text-center max-w-md">
                    {t('timelineDescription')}
                  </p>
                </div>
              </motion.div>
            </Tabs.Content>
          )}
        </AnimatePresence>
      </Tabs.Root>
    </div>
  );
}
