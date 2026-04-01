'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/ds-icon';
import { DsButton } from '@/components/ui/ds-button';
import { csrfFetch, bootstrapCSRFToken } from '@/lib/csrf/client';

/* ---------- types ---------- */
type StatusFilter = 'open' | 'upcoming' | 'closed';
type Program = 'PNRR' | 'PEO' | 'POTJ';

interface ApiCall {
  id: string;
  title: string;
  titleRo: string;
  callCode: string | null;
  status: string;
  budgetMin: number | null;
  budgetMax: number | null;
  submissionStart: string | null;
  submissionEnd: string | null;
  lastVerifiedAt: string | null;
  programName: string;
  programCode: string;
  sourceSlug: string | null;
  sourceName: string | null;
}

interface WebCall {
  title: string;
  program: string;
  sourceUrl: string;
  deadline: string | null;
  budgetRange: string | null;
  status: string;
  summary: string;
}

/* ---------- program badge colors ---------- */
const PROGRAM_STYLES: Record<string, { bg: string; text: string }> = {
  PNRR: { bg: 'bg-[#0071E3]/10', text: 'text-primary' },
  PEO: { bg: 'bg-secondary/10', text: 'text-secondary' },
  POTJ: { bg: 'bg-tertiary/10', text: 'text-tertiary' },
};

const DEFAULT_PROGRAM_STYLE = { bg: 'bg-surface-container', text: 'text-on-surface-variant' };

/* ---------- status filter ---------- */
const STATUS_FILTERS: StatusFilter[] = ['open', 'upcoming', 'closed'];

/* ---------- helpers ---------- */
function getTrustBadge(lastVerifiedAt: string | null): { label: string; color: string } | null {
  if (!lastVerifiedAt) return null;
  const hoursAgo = (Date.now() - new Date(lastVerifiedAt).getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 48) return { label: 'Verified', color: 'text-green-600 bg-green-50' };
  if (hoursAgo > 168) return { label: 'Needs check', color: 'text-amber-600 bg-amber-50' };
  return { label: 'Verified', color: 'text-on-surface-variant bg-surface-container' };
}

function formatBudget(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
  };
  if (min !== null && max !== null) return `${fmt(min)} — ${fmt(max)}`;
  if (max !== null) return `up to ${fmt(max)}`;
  return `from ${fmt(min!)}`;
}

function formatDeadline(submissionEnd: string | null): {
  display: string;
  daysLeft: number | null;
  urgent: boolean;
} {
  if (!submissionEnd) return { display: '—', daysLeft: null, urgent: false };
  const end = new Date(submissionEnd);
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (daysLeft <= 0) return { display: end.toLocaleDateString('ro-RO'), daysLeft: null, urgent: false };
  if (daysLeft <= 60) return { display: String(daysLeft), daysLeft, urgent: daysLeft <= 14 };
  return { display: end.toLocaleDateString('ro-RO'), daysLeft: null, urgent: false };
}

/* ---------- page component ---------- */
export default function FinantariPage({ params }: { params: { locale: string } }) {
  const { locale } = params;
  const t = useTranslations('fundingCallsPage');
  const router = useRouter();

  const [calls, setCalls] = useState<ApiCall[]>([]);
  const [webCalls, setWebCalls] = useState<WebCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch from DB (Layer 1)
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), perPage: '20' });
    if (statusFilter !== 'open') {
      const statusMap: Record<StatusFilter, string> = {
        open: 'deschis',
        upcoming: 'previzionat',
        closed: 'inchis',
      };
      params.set('status', statusMap[statusFilter]);
    } else {
      params.set('status', 'deschis');
    }
    if (search) params.set('search', search);

    fetch(`/api/v1/calls?${params}`)
      .then(res => res.json())
      .then(data => {
        if (page === 1) setCalls(data.data || []);
        else setCalls(prev => [...prev, ...(data.data || [])]);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [page, statusFilter, search]);

  // Auto-trigger AI discovery when DB results are sparse (Layer 3 fallback)
  useEffect(() => {
    if (!loading && calls.length < 3 && !searching && webCalls.length === 0) {
      handleAISearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, calls.length]);

  const handleSearchChange = (value: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setPage(1);
      setSearch(value);
    }, 300);
  };

  const handleFilterChange = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setPage(1);
    setCalls([]);
    setWebCalls([]);
  };

  // Layer 3 — AI Discovery
  const handleAISearch = async () => {
    setSearching(true);
    try {
      await bootstrapCSRFToken();
      const res = await csrfFetch('/api/ai/search-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: search || 'open EU funding calls Romania' }),
      });
      const data = await res.json();
      setWebCalls(data.calls || []);
    } catch {
      // Silently fail — DB calls still visible
    } finally {
      setSearching(false);
    }
  };

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
            <DsButton onClick={handleAISearch} disabled={searching}>
              <Icon name="auto_awesome" />
              <span>{searching ? t('searching') : t('aiSmartMatch')}</span>
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
                  onClick={() => handleFilterChange(filter)}
                  className={`text-xs font-bold px-5 py-2 rounded-full transition-colors ${
                    statusFilter === filter
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
            <div className="relative flex-1 max-w-xs">
              <Icon
                name="search"
                size="sm"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
              />
              <input
                type="text"
                placeholder={t('searchPlaceholder')}
                onChange={e => handleSearchChange(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface-container-low rounded-xl border border-transparent focus:border-primary/20 focus:outline-none transition-all"
              />
            </div>
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
              {loading
                ? t('searching')
                : t('foundCalls', { count: calls.length })}
            </span>
          </div>
        </div>
      </section>

      {/* Error state */}
      {error && (
        <div className="mb-8 p-4 rounded-xl bg-error/10 text-error text-sm font-medium">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && calls.length === 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 mb-24">
          {[1, 2, 3].map(i => (
            <div key={i} className="glass-card rounded-[2rem] p-8 animate-pulse">
              <div className="flex justify-between items-start mb-6">
                <div className="h-6 w-20 bg-surface-container rounded-full" />
                <div className="h-6 w-24 bg-surface-container rounded-full" />
              </div>
              <div className="h-6 w-4/5 bg-surface-container rounded-lg mb-3" />
              <div className="h-4 w-full bg-surface-container rounded-lg mb-2" />
              <div className="h-4 w-3/4 bg-surface-container rounded-lg mb-8" />
              <div className="h-10 w-full bg-surface-container rounded-xl" />
            </div>
          ))}
        </section>
      )}

      {/* Grid */}
      {!loading || calls.length > 0 ? (
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 mb-8">
          {calls.map((call) => {
            const programKey = call.programCode?.toUpperCase() as Program;
            const programStyle = PROGRAM_STYLES[programKey] || DEFAULT_PROGRAM_STYLE;
            const trustBadge = getTrustBadge(call.lastVerifiedAt);
            const budgetStr = formatBudget(call.budgetMin, call.budgetMax);
            const deadline = formatDeadline(call.submissionEnd);
            const displayTitle = call.titleRo || call.title;

            return (
              <div
                key={call.id}
                className="glass-card rounded-[2rem] p-8 flex flex-col hover:shadow-[0_32px_64px_rgba(0,0,0,0.06)] transition-all duration-500 group"
              >
                {/* Header: program badge + trust badge */}
                <div className="flex justify-between items-start mb-6">
                  <span
                    className={`${programStyle.bg} ${programStyle.text} px-4 py-1.5 rounded-full text-xs font-extrabold tracking-widest uppercase`}
                  >
                    {call.programCode || call.programName}
                  </span>
                  {trustBadge && (
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${trustBadge.color}`}>
                      <Icon
                        name={trustBadge.label === 'Verified' ? 'check_circle' : 'warning'}
                        filled
                        size="sm"
                      />
                      <span className="text-[10px] font-bold">
                        {trustBadge.label === 'Verified' ? t('verified') : t('needsCheck')}
                      </span>
                    </div>
                  )}
                </div>

                {/* Title */}
                <h3 className="text-xl font-bold mb-4 leading-tight group-hover:text-primary transition-colors">
                  {displayTitle}
                </h3>
                {call.callCode && (
                  <p className="text-xs text-on-surface-variant mb-2 font-mono">{call.callCode}</p>
                )}
                {call.sourceName && (
                  <p className="text-sm text-on-surface-variant mb-6 line-clamp-1">
                    {call.sourceName}
                  </p>
                )}

                {/* Bottom section */}
                <div className="mt-auto space-y-4">
                  {budgetStr && (
                    <div className="flex items-center justify-between text-sm py-3 border-y border-outline-variant/10">
                      <span className="text-on-surface-variant font-medium">
                        {t('budgetRangeLabel')}
                      </span>
                      <span className="font-bold text-on-surface">&euro;{budgetStr}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span
                        className={`text-[10px] uppercase tracking-wider font-bold ${
                          deadline.urgent ? 'text-error/80' : 'text-on-surface-variant'
                        }`}
                      >
                        {t('deadlineLabel')}
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          deadline.urgent ? 'text-error' : 'text-on-surface'
                        }`}
                      >
                        {deadline.daysLeft !== null
                          ? `${deadline.daysLeft} ${t('daysLeft')}`
                          : deadline.display}
                      </span>
                    </div>
                    <DsButton
                      size="sm"
                      onClick={() => router.push(`/${locale}/asistent-ai`)}
                    >
                      {t('startProject')}
                    </DsButton>
                  </div>
                </div>
              </div>
            );
          })}

          {/* No results */}
          {!loading && calls.length === 0 && webCalls.length === 0 && !searching && (
            <div className="col-span-full flex flex-col items-center py-24 text-center">
              <Icon name="search_off" size="lg" className="text-on-surface-variant/40 mb-4" />
              <p className="text-on-surface font-bold mb-2">{t('noResults')}</p>
              <p className="text-sm text-on-surface-variant">{t('noResultsDescription')}</p>
            </div>
          )}

          {/* Stay Updated CTA card */}
          {calls.length > 0 && (
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
          )}
        </section>
      ) : null}

      {/* Load more */}
      {!loading && calls.length > 0 && calls.length % 20 === 0 && (
        <div className="flex justify-center mb-12">
          <DsButton
            variant="secondary"
            onClick={() => setPage(p => p + 1)}
          >
            {t('loadMore')}
          </DsButton>
        </div>
      )}

      {/* Layer 3: AI Discovery results */}
      {(webCalls.length > 0 || searching) && (
        <section className="mb-24">
          <h3 className="text-lg font-semibold text-on-surface mb-4 flex items-center gap-2">
            <Icon name="auto_awesome" size="sm" className="text-primary" />
            {searching
              ? t('searching')
              : t('aiDiscoveryTitle', { count: webCalls.length })}
          </h3>

          {searching && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {[1, 2].map(i => (
                <div key={i} className="glass-card rounded-[2rem] p-8 animate-pulse opacity-60">
                  <div className="h-6 w-20 bg-surface-container rounded-full mb-4" />
                  <div className="h-5 w-4/5 bg-surface-container rounded-lg mb-3" />
                  <div className="h-4 w-full bg-surface-container rounded-lg mb-2" />
                  <div className="h-4 w-3/4 bg-surface-container rounded-lg" />
                </div>
              ))}
            </div>
          )}

          {!searching && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {webCalls.map((call, i) => (
                <div
                  key={i}
                  className="opacity-70 glass-card rounded-[2rem] p-8 flex flex-col hover:opacity-90 transition-all duration-300 group"
                >
                  <div className="flex justify-between items-start mb-6">
                    <span className="text-xs font-bold text-secondary bg-secondary/10 px-2 py-1 rounded-full uppercase tracking-widest">
                      {t('webResult')}
                    </span>
                    {call.program && (
                      <span className="text-xs text-on-surface-variant font-semibold">
                        {call.program}
                      </span>
                    )}
                  </div>

                  <h3 className="text-xl font-bold mb-3 leading-tight group-hover:text-primary transition-colors">
                    {call.title}
                  </h3>
                  <p className="text-sm text-on-surface-variant mb-6 line-clamp-3">
                    {call.summary}
                  </p>

                  <div className="mt-auto space-y-4">
                    {(call.budgetRange || call.deadline) && (
                      <div className="flex items-center justify-between text-sm py-3 border-y border-outline-variant/10">
                        {call.budgetRange && (
                          <>
                            <span className="text-on-surface-variant font-medium">
                              {t('budgetRangeLabel')}
                            </span>
                            <span className="font-bold text-on-surface">{call.budgetRange}</span>
                          </>
                        )}
                        {!call.budgetRange && call.deadline && (
                          <>
                            <span className="text-on-surface-variant font-medium">
                              {t('deadlineLabel')}
                            </span>
                            <span className="font-bold text-on-surface">{call.deadline}</span>
                          </>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      {call.sourceUrl && (
                        <a
                          href={call.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary underline underline-offset-2 truncate"
                        >
                          {call.sourceUrl.replace(/^https?:\/\//, '').split('/')[0]}
                        </a>
                      )}
                      <DsButton
                        variant="primary"
                        size="sm"
                        onClick={() => router.push(`/${locale}/asistent-ai`)}
                      >
                        {t('startProject')}
                      </DsButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
