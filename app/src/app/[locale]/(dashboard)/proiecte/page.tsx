import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Icon } from '@/components/ui/ds-icon';
import { DsButton } from '@/components/ui/ds-button';

/* ---------- types ---------- */
type ProjectStatus = 'in_progress' | 'submitted' | 'approved' | 'draft';

interface PlaceholderProject {
  id: string;
  title: string;
  organization: string;
  code: string;
  status: ProjectStatus;
  progress: number;
  teamCount: number;
  lastActivity: string;
}

/* ---------- placeholder data ---------- */
const PROJECTS: PlaceholderProject[] = [
  {
    id: '1',
    title: 'Digitalizarea Administrației Publice Locale',
    organization: 'Green City Alliance',
    code: 'EU-77291',
    status: 'in_progress',
    progress: 75,
    teamCount: 5,
    lastActivity: '2h',
  },
  {
    id: '2',
    title: 'Diagnosticare Cancer cu AI',
    organization: 'BioMed Research Lab',
    code: 'EU-90112',
    status: 'submitted',
    progress: 100,
    teamCount: 1,
    lastActivity: 'Mar 12',
  },
  {
    id: '3',
    title: 'Infrastructura Eoliana Offshore Baltică',
    organization: 'Nordic Energy Group',
    code: 'EU-11200',
    status: 'approved',
    progress: 100,
    teamCount: 2,
    lastActivity: 'Feb 28',
  },
  {
    id: '4',
    title: 'Inițiativa Transfrontalieră de Alfabetizare Digitală',
    organization: 'EduGlobal Foundation',
    code: 'EU-PENDING',
    status: 'draft',
    progress: 15,
    teamCount: 1,
    lastActivity: 'now',
  },
];

/* ---------- status styling ---------- */
const STATUS_STYLES: Record<ProjectStatus, { bg: string; text: string; ring: string }> = {
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', ring: 'stroke-primary' },
  submitted: { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'stroke-amber-500' },
  approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'stroke-emerald-500' },
  draft: { bg: 'bg-slate-200', text: 'text-slate-600', ring: 'stroke-slate-400' },
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
          <Icon name="person" size="sm" className="text-slate-500 text-[10px]" />
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

/* ---------- filter chips ---------- */
const FILTERS = ['all', 'in_progress', 'submitted', 'approved'] as const;

/* ---------- page component ---------- */
export default function ProiectePage() {
  const t = useTranslations('projects');


  return (
    <div className="fade-in-up max-w-7xl mx-auto">
      {/* Header */}
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
          <DsButton size="lg">
            <Icon name="add" />
            <span>{t('createProject')}</span>
          </DsButton>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col md:flex-row gap-6 items-center">
          <div className="relative flex-1 w-full">
            <Icon
              name="search"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/40"
            />
            <input
              className="w-full pl-12 pr-4 py-4 bg-surface-container-high border-none rounded-full focus:ring-2 focus:ring-primary/20 transition-all text-on-surface placeholder:text-on-surface-variant/50"
              placeholder={t('searchPlaceholder')}
              type="text"
            />
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 w-full md:w-auto">
            {FILTERS.map((filter, idx) => (
              <button
                key={filter}
                className={`px-6 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  idx === 0
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

      {/* Projects Grid */}
      <section
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-24"
        style={{ animationDelay: '100ms' }}
      >
        {PROJECTS.map((project) => {
          const style = STATUS_STYLES[project.status];
          return (
            <Link
              key={project.id}
              href={`proiecte/${project.id}`}
              className="glass-card rounded-[1.5rem] p-8 flex flex-col hover:shadow-[0_20px_40px_rgba(0,0,0,0.04)] transition-all cursor-pointer group"
            >
              {/* Status + Progress */}
              <div className="flex justify-between items-start mb-6">
                <span
                  className={`${style.bg} ${style.text} px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase`}
                >
                  {t(`statusLabels.${project.status}`)}
                </span>
                <ProgressRing progress={project.progress} status={project.status} />
              </div>

              {/* Title */}
              <h3 className="text-xl font-bold text-on-surface leading-tight mb-2 group-hover:text-primary transition-colors">
                {project.title}
              </h3>
              <p className="text-on-surface-variant text-sm mb-8">
                {project.organization} &bull; ID: {project.code}
              </p>

              {/* Footer */}
              <div className="mt-auto flex items-center justify-between">
                <TeamAvatars count={project.teamCount} />
                <p className="text-[10px] text-on-surface-variant/60 font-medium uppercase">
                  {t('modified')} {project.lastActivity}
                </p>
              </div>
            </Link>
          );
        })}
      </section>

      {/* Archive Section */}
      <section className="max-w-4xl mx-auto py-24 text-center fade-in-up" style={{ animationDelay: '200ms' }}>
        <div className="relative inline-block mb-10">
          <div className="absolute inset-0 bg-secondary/10 blur-[80px] rounded-full scale-150" />
          <div className="relative glass-card rounded-[1.5rem] w-64 h-64 flex flex-col items-center justify-center mx-auto">
            <Icon name="inventory_2" size="lg" className="text-on-surface-variant/40 mb-4" />
            <p className="text-on-surface-variant/60 font-medium text-sm">
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
    </div>
  );
}
