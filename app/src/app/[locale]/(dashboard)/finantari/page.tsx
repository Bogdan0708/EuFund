'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/ds-icon';
import { DsButton } from '@/components/ui/ds-button';

/* ---------- types ---------- */
type CallStatus = 'open' | 'upcoming' | 'closed';
type Program = 'PNRR' | 'PEO' | 'POTJ';

interface FundingCall {
  id: string;
  title: string;
  description: string;
  program: Program;
  budgetRange: string;
  deadline: string;
  deadlineDays: number | null;
  verified: string;
  status: CallStatus;
}

/* ---------- placeholder data ---------- */
const FUNDING_CALLS: FundingCall[] = [
  {
    id: '1',
    title: 'Digitalization of Public Administration and Services',
    description: 'Support for the migration of local authority data to secure cloud infrastructure and modern API integration.',
    program: 'PNRR',
    budgetRange: '500k — 2.4M',
    deadline: '14',
    deadlineDays: 14,
    verified: 'Oct 24',
    status: 'open',
  },
  {
    id: '2',
    title: 'Green Innovation Ecosystems for Urban Transport',
    description: 'Research and deployment of hydrogen-based public transit solutions in metropolitan areas.',
    program: 'PEO',
    budgetRange: '1.2M — 5.0M',
    deadline: 'Nov 15, 2024',
    deadlineDays: null,
    verified: 'Oct 22',
    status: 'open',
  },
  {
    id: '3',
    title: 'Reskilling Industrial Workforce for Green Transition',
    description: 'Large-scale educational programs for workers in regions affected by decarbonization efforts.',
    program: 'POTJ',
    budgetRange: '250k — 850k',
    deadline: 'Dec 01, 2024',
    deadlineDays: null,
    verified: 'Oct 20',
    status: 'open',
  },
  {
    id: '4',
    title: 'Enhancing Cyber Resilience in SME Supply Chains',
    description: 'Direct funding for implementing advanced SOC capabilities and NIST-aligned security frameworks.',
    program: 'PNRR',
    budgetRange: '100k — 300k',
    deadline: '4',
    deadlineDays: 4,
    verified: 'Oct 24',
    status: 'open',
  },
  {
    id: '5',
    title: 'Sustainable Agriculture: Circular Bio-waste',
    description: 'Grants for small-to-medium farming co-operatives to implement zero-waste processing plants.',
    program: 'PEO',
    budgetRange: '2.0M — 7.5M',
    deadline: 'Jan 12, 2025',
    deadlineDays: null,
    verified: 'Oct 19',
    status: 'open',
  },
];

/* ---------- program badge colors ---------- */
const PROGRAM_STYLES: Record<Program, { bg: string; text: string }> = {
  PNRR: { bg: 'bg-[#0071E3]/10', text: 'text-primary' },
  PEO: { bg: 'bg-secondary/10', text: 'text-secondary' },
  POTJ: { bg: 'bg-tertiary/10', text: 'text-tertiary' },
};

/* ---------- status filter ---------- */
const STATUS_FILTERS: CallStatus[] = ['open', 'upcoming', 'closed'];

/* ---------- page component ---------- */
export default function FinantariPage() {
  const t = useTranslations('fundingCallsPage');
  const [activeFilter, setActiveFilter] = useState<CallStatus>('open');

  return (
    <div className="fade-in-up max-w-[1440px] mx-auto">
      {/* Hero header */}
      <section className="mb-20">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
          <div className="max-w-2xl">
            <h1 className="text-5xl font-bold tracking-tight text-on-surface mb-6 leading-tight">
              {t.rich('heroTitle', {
                highlight: (chunks) => (
                  <span className="text-primary">{chunks}</span>
                ),
              })}
            </h1>
            <p className="text-lg text-on-surface-variant leading-relaxed">
              {t('heroDescription')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <DsButton>
              <Icon name="auto_awesome" />
              <span>{t('aiSmartMatch')}</span>
            </DsButton>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="glass-card rounded-[1.5rem] p-4 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant px-2">
              {t('statusLabel')}:
            </span>
            <div className="flex bg-surface-container-low p-1 rounded-full">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={`text-xs font-bold px-5 py-2 rounded-full transition-colors ${
                    activeFilter === filter
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-on-surface-variant hover:bg-white/50'
                  }`}
                >
                  {t(`statusFilter.${filter}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="h-8 w-[1px] bg-outline-variant/30 hidden lg:block" />

          <div className="flex items-center gap-4 flex-1">
            <button className="flex items-center gap-2 text-sm font-semibold bg-surface-container-low px-4 py-2.5 rounded-xl border border-transparent hover:border-primary/20 transition-all">
              {t('programType')}
              <Icon name="keyboard_arrow_down" size="sm" />
            </button>
            <button className="flex items-center gap-2 text-sm font-semibold bg-surface-container-low px-4 py-2.5 rounded-xl border border-transparent hover:border-primary/20 transition-all">
              {t('budgetRange')}
              <Icon name="keyboard_arrow_down" size="sm" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-on-surface-variant">
            <span className="text-sm font-medium">
              {t('foundCalls', { count: FUNDING_CALLS.length })}
            </span>
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 mb-24">
        {FUNDING_CALLS.map((call) => {
          const programStyle = PROGRAM_STYLES[call.program];
          const isUrgent = call.deadlineDays !== null && call.deadlineDays <= 14;

          return (
            <div
              key={call.id}
              className="glass-card rounded-[2rem] p-8 flex flex-col hover:shadow-[0_32px_64px_rgba(0,0,0,0.06)] transition-all duration-500 group"
            >
              {/* Header: program badge + verified */}
              <div className="flex justify-between items-start mb-6">
                <span
                  className={`${programStyle.bg} ${programStyle.text} px-4 py-1.5 rounded-full text-xs font-extrabold tracking-widest uppercase`}
                >
                  {call.program}
                </span>
                <div className="flex items-center gap-1.5 text-green-600 bg-green-50 px-3 py-1 rounded-full">
                  <Icon name="check_circle" filled size="sm" className="text-green-600" />
                  <span className="text-[10px] font-bold">
                    {t('verified')} {call.verified}
                  </span>
                </div>
              </div>

              {/* Title + description */}
              <h3 className="text-xl font-bold mb-4 leading-tight group-hover:text-primary transition-colors">
                {call.title}
              </h3>
              <p className="text-sm text-on-surface-variant mb-8 line-clamp-2">
                {call.description}
              </p>

              {/* Bottom section */}
              <div className="mt-auto space-y-4">
                <div className="flex items-center justify-between text-sm py-3 border-y border-outline-variant/10">
                  <span className="text-on-surface-variant font-medium">
                    {t('budgetRangeLabel')}
                  </span>
                  <span className="font-bold text-on-surface">
                    &euro;{call.budgetRange}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span
                      className={`text-[10px] uppercase tracking-wider font-bold ${
                        isUrgent ? 'text-error/80' : 'text-on-surface-variant'
                      }`}
                    >
                      {t('deadlineLabel')}
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        isUrgent ? 'text-error' : 'text-on-surface'
                      }`}
                    >
                      {call.deadlineDays !== null
                        ? `${call.deadlineDays} ${t('daysLeft')}`
                        : call.deadline}
                    </span>
                  </div>
                  <DsButton size="sm">
                    {t('apply')}
                  </DsButton>
                </div>
              </div>
            </div>
          );
        })}

        {/* Stay Updated CTA card */}
        <div className="glass-card rounded-[2rem] p-1 flex items-center justify-center border-dashed border-2 border-outline-variant/30 bg-transparent min-h-[360px]">
          <div className="text-center p-8">
            <div className="w-16 h-16 bg-surface-container-low rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="notifications_active" size="lg" className="text-primary/40" />
            </div>
            <p className="text-on-surface font-bold">{t('stayUpdated')}</p>
            <p className="text-sm text-on-surface-variant mb-6 mt-2">
              {t('stayUpdatedDescription')}
            </p>
            <button className="text-primary font-bold text-sm underline underline-offset-4">
              {t('setupAlert')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
