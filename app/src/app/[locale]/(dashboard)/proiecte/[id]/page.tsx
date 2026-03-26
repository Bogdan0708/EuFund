'use client';

import { useTranslations } from 'next-intl';
import * as Tabs from '@radix-ui/react-tabs';
import { Icon } from '@/components/ui/ds-icon';
import { DsButton } from '@/components/ui/ds-button';

/* ---------- placeholder data ---------- */
const PROJECT = {
  id: 'EU-H2024-MOB-082',
  title: 'Horizon-2024: Sustainable Urban Mobility',
  status: 'in_progress' as const,
  grantAllocation: '2.4M',
  duration: '36',
  consortiumSize: 12,
  progress: 65,
  deadlineDays: 14,
  deliverable: 'D3.4',
  summary:
    'This project aims to redefine the infrastructure of European mid-sized cities through the integration of autonomous micro-mobility fleets and decentralized energy grids. Our focus remains on the reduction of carbon emissions by 45% within the first operational year through adaptive AI routing.',
  team: [
    { name: 'Dr. Rossi', role: 'Lead Scientist' },
    { name: 'M. Chen', role: 'Tech Lead' },
    { name: 'A. Weber', role: 'Project Manager' },
    { name: 'J. Doe', role: 'Engineer' },
  ],
  documents: [
    { id: '1', name: 'Technical Annex v2.3.pdf', size: '4.2 MB', date: 'Mar 20, 2026', icon: 'picture_as_pdf' },
    { id: '2', name: 'Budget Breakdown.xlsx', size: '1.1 MB', date: 'Mar 18, 2026', icon: 'table_chart' },
    { id: '3', name: 'Consortium Agreement.docx', size: '890 KB', date: 'Mar 15, 2026', icon: 'description' },
    { id: '4', name: 'Risk Assessment Matrix.pdf', size: '2.3 MB', date: 'Mar 10, 2026', icon: 'picture_as_pdf' },
  ],
  tasks: [
    { id: '1', title: 'Finalize Technical Annex', assignee: 'Dr. Rossi', status: 'in_progress', priority: 'high' },
    { id: '2', title: 'Submit WP3 Deliverable', assignee: 'M. Chen', status: 'pending', priority: 'high' },
    { id: '3', title: 'Budget Revision Q2', assignee: 'A. Weber', status: 'completed', priority: 'medium' },
    { id: '4', title: 'Partner Review Meeting', assignee: 'J. Doe', status: 'pending', priority: 'low' },
  ],
  milestones: [
    { id: '1', title: 'Project Kickoff', date: 'Jan 2024', status: 'completed' },
    { id: '2', title: 'WP1 Completion', date: 'Jun 2024', status: 'completed' },
    { id: '3', title: 'Mid-term Review', date: 'Jan 2025', status: 'in_progress' },
    { id: '4', title: 'WP3 Deliverable Due', date: 'Apr 2025', status: 'upcoming' },
    { id: '5', title: 'Final Report Submission', date: 'Dec 2026', status: 'upcoming' },
  ],
};

const TASK_STATUS_STYLES: Record<string, string> = {
  in_progress: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

const MILESTONE_STATUS_STYLES: Record<string, { dot: string; line: string }> = {
  completed: { dot: 'bg-emerald-500', line: 'bg-emerald-200' },
  in_progress: { dot: 'bg-primary', line: 'bg-primary-fixed' },
  upcoming: { dot: 'bg-slate-300', line: 'bg-slate-200' },
};

const PRIORITY_ICON: Record<string, { icon: string; color: string }> = {
  high: { icon: 'priority_high', color: 'text-error' },
  medium: { icon: 'remove', color: 'text-amber-500' },
  low: { icon: 'keyboard_arrow_down', color: 'text-slate-400' },
};

/* ---------- large progress ring ---------- */
function LargeProgressRing({ progress }: { progress: number }) {
  const circumference = 2 * Math.PI * 70;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative w-40 h-40 mb-8">
      <svg className="w-full h-full -rotate-90">
        <circle
          cx="80"
          cy="80"
          r="70"
          fill="none"
          stroke="#F4F3F8"
          strokeWidth="12"
        />
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
function TabTrigger({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <Tabs.Trigger
      value={value}
      className="pb-4 text-lg font-medium text-on-surface-variant hover:text-on-surface transition-colors data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:border-b-2 data-[state=active]:border-primary"
    >
      {children}
    </Tabs.Trigger>
  );
}

/* ---------- page component ---------- */
export default function ProiectDetailPage({
  params: { id },
}: {
  params: { id: string };
}) {
  const t = useTranslations('projectDetail');

  return (
    <div className="fade-in-up max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-on-surface-variant font-medium text-sm mb-8">
        {t('breadcrumb')} / {PROJECT.title.split(':')[0]}
      </div>

      {/* Hero */}
      <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-16">
        <div className="space-y-4 max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="px-4 py-1.5 bg-[#0071E3]/10 text-[#0071E3] text-xs font-bold rounded-full uppercase tracking-wider">
              {t('statusInProgress')}
            </span>
            <span className="text-on-surface-variant text-sm font-medium">
              ID: {PROJECT.id}
            </span>
          </div>
          <h2 className="text-5xl font-bold tracking-tight text-on-surface leading-tight">
            {PROJECT.title}
          </h2>
        </div>
        <div className="flex gap-3">
          <DsButton variant="ghost" className="border border-outline-variant/30">
            <Icon name="share" size="sm" />
            <span>{t('share')}</span>
          </DsButton>
          <DsButton variant="primary" className="bg-on-surface hover:bg-on-surface/90">
            <Icon name="edit" size="sm" />
            <span>{t('editProject')}</span>
          </DsButton>
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
                <p className="text-on-surface-variant text-lg leading-relaxed mb-8">
                  {PROJECT.summary}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-8 pt-8 border-t border-outline-variant/10">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant opacity-60 mb-1">
                      {t('grantAllocation')}
                    </p>
                    <p className="text-2xl font-bold text-on-surface">
                      &euro;{PROJECT.grantAllocation}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant opacity-60 mb-1">
                      {t('duration')}
                    </p>
                    <p className="text-2xl font-bold text-on-surface">
                      {PROJECT.duration} {t('months')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant opacity-60 mb-1">
                      {t('consortiumSize')}
                    </p>
                    <p className="text-2xl font-bold text-on-surface">
                      {PROJECT.consortiumSize} {t('partners')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Team */}
              <div className="bg-surface-container-low rounded-[1rem] p-10">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-bold">{t('projectTeam')}</h3>
                  <button className="text-primary font-bold text-sm">
                    {t('inviteMember')}
                  </button>
                </div>
                <div className="flex flex-wrap gap-12">
                  {PROJECT.team.map((member) => (
                    <div
                      key={member.name}
                      className="flex flex-col items-center gap-3"
                    >
                      <div className="w-16 h-16 rounded-full ring-4 ring-white shadow-sm bg-surface-container-high flex items-center justify-center">
                        <Icon name="person" className="text-on-surface-variant" />
                      </div>
                      <span className="text-sm font-bold">{member.name}</span>
                    </div>
                  ))}
                  <div className="w-16 h-16 rounded-full border-2 border-dashed border-outline-variant flex items-center justify-center text-outline-variant cursor-pointer hover:border-primary hover:text-primary transition-colors">
                    <Icon name="add" />
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="col-span-12 lg:col-span-4 space-y-8">
              {/* Progress Ring Card */}
              <div className="bg-white rounded-[1rem] p-10 shadow-sm flex flex-col items-center text-center">
                <LargeProgressRing progress={PROJECT.progress} />
                <h4 className="text-lg font-bold mb-2">{t('technicalReporting')}</h4>
                <p className="text-on-surface-variant text-sm mb-6">
                  {t('deliverableDue', { code: PROJECT.deliverable })}
                </p>
                <div className="w-full bg-surface-container p-4 rounded-xl flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Icon name="event_upcoming" className="text-primary" />
                    <span className="text-sm font-semibold">{t('deadline')}</span>
                  </div>
                  <span className="text-sm font-bold text-error">
                    {PROJECT.deadlineDays} {t('daysLeft')}
                  </span>
                </div>
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
                <button className="w-full py-3 bg-secondary/10 text-secondary font-bold text-sm rounded-full hover:bg-secondary/20 transition-colors">
                  {t('applySuggestion')}
                </button>
              </div>
            </div>
          </div>
        </Tabs.Content>

        {/* ---- Documents Tab ---- */}
        <Tabs.Content value="documents">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PROJECT.documents.map((doc) => (
              <div
                key={doc.id}
                className="glass-card rounded-[1rem] p-6 flex items-center gap-5 hover:shadow-[0_20px_40px_rgba(0,0,0,0.04)] transition-all group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-xl bg-primary-fixed flex items-center justify-center shrink-0">
                  <Icon name={doc.icon} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-on-surface truncate group-hover:text-primary transition-colors">
                    {doc.name}
                  </h4>
                  <p className="text-sm text-on-surface-variant">
                    {doc.size} &bull; {doc.date}
                  </p>
                </div>
                <Icon
                  name="download"
                  className="text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </div>
            ))}
          </div>

          {/* Upload area */}
          <div className="mt-8 border-2 border-dashed border-outline-variant/30 rounded-[1rem] p-12 text-center">
            <Icon name="cloud_upload" size="lg" className="text-primary/40 mx-auto mb-4" />
            <p className="font-bold text-on-surface mb-1">{t('uploadTitle')}</p>
            <p className="text-sm text-on-surface-variant">{t('uploadFormats')}</p>
          </div>
        </Tabs.Content>

        {/* ---- Tasks Tab ---- */}
        <Tabs.Content value="tasks">
          <div className="space-y-4">
            {PROJECT.tasks.map((task) => (
              <div
                key={task.id}
                className="glass-card rounded-[1rem] p-6 flex items-center gap-5 hover:shadow-[0_20px_40px_rgba(0,0,0,0.04)] transition-all"
              >
                {/* Priority indicator */}
                <Icon
                  name={PRIORITY_ICON[task.priority].icon}
                  size="sm"
                  className={PRIORITY_ICON[task.priority].color}
                />

                {/* Task details */}
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-on-surface">{task.title}</h4>
                  <p className="text-sm text-on-surface-variant">
                    {t('assignedTo')}: {task.assignee}
                  </p>
                </div>

                {/* Status */}
                <span
                  className={`${TASK_STATUS_STYLES[task.status]} px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase`}
                >
                  {t(`taskStatus.${task.status}`)}
                </span>
              </div>
            ))}
          </div>
        </Tabs.Content>

        {/* ---- Timeline Tab ---- */}
        <Tabs.Content value="timeline">
          <div className="max-w-2xl">
            {PROJECT.milestones.map((milestone, idx) => {
              const styles = MILESTONE_STATUS_STYLES[milestone.status];
              const isLast = idx === PROJECT.milestones.length - 1;

              return (
                <div key={milestone.id} className="flex gap-6">
                  {/* Timeline line + dot */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-4 h-4 rounded-full ${styles.dot} shrink-0 mt-1 ${
                        milestone.status === 'in_progress'
                          ? 'ring-4 ring-primary/20'
                          : ''
                      }`}
                    />
                    {!isLast && (
                      <div
                        className={`w-0.5 flex-1 ${styles.line} min-h-[3rem]`}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="pb-8">
                    <h4 className="font-bold text-on-surface">{milestone.title}</h4>
                    <p className="text-sm text-on-surface-variant">{milestone.date}</p>
                    {milestone.status === 'completed' && (
                      <span className="inline-flex items-center gap-1 mt-2 text-emerald-600 text-xs font-bold">
                        <Icon name="check_circle" filled size="sm" />
                        {t('milestoneCompleted')}
                      </span>
                    )}
                    {milestone.status === 'in_progress' && (
                      <span className="inline-flex items-center gap-1 mt-2 text-primary text-xs font-bold">
                        <Icon name="pending" size="sm" />
                        {t('milestoneInProgress')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
