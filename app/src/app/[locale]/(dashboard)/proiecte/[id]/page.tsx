'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Tabs from '@radix-ui/react-tabs';
import { Icon } from '@/components/ui/ds-icon';
import { DsButton } from '@/components/ui/ds-button';

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
  category: string;
  description: string | null;
  createdAt: string;
}

interface WorkflowSession {
  id: string;
  currentStep: string | null;
  status: string;
  projectId: string | null;
  projectTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ---------- status display map ---------- */
const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  ciorna:      { label: 'Draft',        color: 'text-on-surface-variant bg-surface-container' },
  in_lucru:    { label: 'In Progress',  color: 'text-primary bg-primary-fixed' },
  verificare:  { label: 'Under Review', color: 'text-amber-700 bg-amber-50' },
  aprobat:     { label: 'Approved',     color: 'text-green-700 bg-green-50' },
  finalizat:   { label: 'Completed',    color: 'text-green-700 bg-green-50' },
  draft:       { label: 'Draft',        color: 'text-on-surface-variant bg-surface-container' },
  action_plan: { label: 'Action Plan',  color: 'text-amber-700 bg-amber-50' },
  built:       { label: 'Built',        color: 'text-primary bg-primary-fixed' },
  exported:    { label: 'Exported',     color: 'text-green-700 bg-green-50' },
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
function LargeProgressRing({ progress }: { progress: number }) {
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
          Complete
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

/* ---------- page component ---------- */
export default function ProiectDetailPage({ params }: { params: { id: string } }) {
  const t = useTranslations('projectDetail');
  const router = useRouter();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [aiSessionId, setAiSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch project details
  useEffect(() => {
    fetch(`/api/v1/projects/${params.id}`)
      .then(res => {
        if (!res.ok) throw new Error('Project not found');
        return res.json();
      })
      .then(data => {
        setProject(data.data || data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [params.id]);

  // Fetch files when project loads
  useEffect(() => {
    if (!project) return;
    setFilesLoading(true);
    fetch(`/api/v1/projects/${params.id}/files`)
      .then(res => res.ok ? res.json() : { files: [] })
      .then(data => setFiles(data.files ?? []))
      .catch(() => setFiles([]))
      .finally(() => setFilesLoading(false));
  }, [params.id, project]);

  // Find linked AI session
  useEffect(() => {
    if (!project) return;
    fetch('/api/ai/orchestrator/sessions?limit=20')
      .then(res => res.ok ? res.json() : { sessions: [] })
      .then(data => {
        const sessions: WorkflowSession[] = data.sessions ?? [];
        const linked = sessions.find(s => s.projectId === params.id && s.status === 'active');
        setAiSessionId(linked?.id ?? null);
      })
      .catch(() => setAiSessionId(null));
  }, [params.id, project]);

  if (loading) return <PageSkeleton />;

  if (error || !project) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center py-32 gap-6">
        <Icon name="error_outline" size="lg" className="text-error" />
        <h2 className="text-2xl font-bold text-on-surface">{t('projectNotFound')}</h2>
        <DsButton variant="ghost" onClick={() => router.push('/proiecte')}>
          <Icon name="arrow_back" size="sm" />
          <span>{t('backToProjects')}</span>
        </DsButton>
      </div>
    );
  }

  const statusInfo = STATUS_DISPLAY[project.status] ?? {
    label: project.status,
    color: 'text-on-surface-variant bg-surface-container',
  };

  const complianceScore = project.complianceScore ? Math.round(parseFloat(project.complianceScore)) : 0;
  const matchScore = project.matchScore ? Math.round(parseFloat(project.matchScore)) : null;

  return (
    <div className="fade-in-up max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-on-surface-variant font-medium text-sm mb-8">
        <button
          onClick={() => router.push('/proiecte')}
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
            <span className={`px-4 py-1.5 text-xs font-bold rounded-full uppercase tracking-wider ${statusInfo.color}`}>
              {statusInfo.label}
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
          <DsButton variant="ghost" className="border border-outline-variant/30">
            <Icon name="share" size="sm" />
            <span>{t('share')}</span>
          </DsButton>
          {aiSessionId ? (
            <DsButton
              variant="primary"
              className="bg-on-surface hover:bg-on-surface/90"
              onClick={() => router.push(`/asistent-ai?session=${aiSessionId}`)}
            >
              <Icon name="smart_toy" size="sm" />
              <span>{t('resumeAI')}</span>
            </DsButton>
          ) : (
            <DsButton
              variant="primary"
              className="bg-on-surface hover:bg-on-surface/90"
              onClick={() => router.push('/asistent-ai')}
            >
              <Icon name="smart_toy" size="sm" />
              <span>{t('startAI')}</span>
            </DsButton>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs.Root defaultValue="overview">
        <Tabs.List className="flex gap-10 mb-12 border-b border-outline-variant/15">
          <TabTrigger value="overview">{t('tabs.overview')}</TabTrigger>
          <TabTrigger value="documents">{t('tabs.documents')}</TabTrigger>
          <TabTrigger value="tasks">{t('tabs.tasks')}</TabTrigger>
          <TabTrigger value="timeline">{t('tabs.timeline')}</TabTrigger>
        </Tabs.List>

        {/* ---- Overview Tab ---- */}
        <Tabs.Content value="overview">
          <div className="grid grid-cols-12 gap-8">
            {/* Main Content */}
            <div className="col-span-12 lg:col-span-8 space-y-8">
              {/* Executive Summary */}
              <div className="glass-card rounded-[1rem] p-10 shadow-[0_20px_40px_rgba(0,0,0,0.04)]">
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

              {/* Project metadata */}
              <div className="bg-surface-container-low rounded-[1rem] p-10">
                <h3 className="text-xl font-bold mb-6">{t('projectDetails')}</h3>
                <div className="grid grid-cols-2 gap-6">
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
              </div>
            </div>

            {/* Sidebar */}
            <div className="col-span-12 lg:col-span-4 space-y-8">
              {/* Progress Ring Card */}
              <div className="bg-white rounded-[1rem] p-10 shadow-sm flex flex-col items-center text-center">
                <LargeProgressRing progress={complianceScore} />
                <h4 className="text-lg font-bold mb-2">{t('complianceScore')}</h4>
                <p className="text-on-surface-variant text-sm mb-6">
                  {t('complianceDescription')}
                </p>
                {complianceScore === 0 && (
                  <p className="text-xs text-on-surface-variant opacity-60 italic">
                    {t('noComplianceYet')}
                  </p>
                )}
              </div>

              {/* AI Insight Card */}
              <div className="glass-card rounded-[1rem] p-8 relative overflow-hidden">
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
        </Tabs.Content>

        {/* ---- Documents Tab ---- */}
        <Tabs.Content value="documents">
          {filesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3].map(i => (
                <SkeletonBlock key={i} className="h-24" />
              ))}
            </div>
          ) : files.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {files.map(file => (
                <div
                  key={file.id}
                  className="glass-card rounded-[1rem] p-6 flex items-center gap-5 hover:shadow-[0_20px_40px_rgba(0,0,0,0.04)] transition-all group cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary-fixed flex items-center justify-center shrink-0">
                    <Icon name={mimeTypeToIcon(file.mimeType)} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-on-surface truncate group-hover:text-primary transition-colors">
                      {file.filename}
                    </h4>
                    <p className="text-sm text-on-surface-variant">
                      {formatBytes(file.sizeBytes)} &bull; {formatDate(file.createdAt)}
                    </p>
                    {file.category && file.category !== 'uploaded' && (
                      <span className="text-xs text-primary font-semibold capitalize">{file.category}</span>
                    )}
                  </div>
                  <Icon
                    name="download"
                    className="text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <Icon name="folder_open" size="lg" className="text-on-surface-variant/40 mx-auto mb-4" />
              <p className="font-bold text-on-surface mb-2">{t('noDocuments')}</p>
              <p className="text-sm text-on-surface-variant">{t('uploadTitle')}</p>
            </div>
          )}

          {/* Upload area */}
          <div className="mt-8 border-2 border-dashed border-outline-variant/30 rounded-[1rem] p-12 text-center">
            <Icon name="cloud_upload" size="lg" className="text-primary/40 mx-auto mb-4" />
            <p className="font-bold text-on-surface mb-1">{t('uploadTitle')}</p>
            <p className="text-sm text-on-surface-variant">{t('uploadFormats')}</p>
          </div>
        </Tabs.Content>

        {/* ---- Tasks Tab ---- */}
        <Tabs.Content value="tasks">
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Icon name="task_alt" size="lg" className="text-on-surface-variant/40" />
            <h3 className="text-xl font-bold text-on-surface">{t('noTasks')}</h3>
            <p className="text-sm text-on-surface-variant text-center max-w-md">
              {t('tasksPlaceholder')}
            </p>
          </div>
        </Tabs.Content>

        {/* ---- Timeline Tab ---- */}
        <Tabs.Content value="timeline">
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Icon name="timeline" size="lg" className="text-on-surface-variant/40" />
            <h3 className="text-xl font-bold text-on-surface">{t('timelinePlaceholder')}</h3>
            <p className="text-sm text-on-surface-variant text-center max-w-md">
              {t('timelineDescription')}
            </p>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
