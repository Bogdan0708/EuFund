'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { diffWordsWithSpace } from 'diff';
import { bootstrapCSRFToken, csrfFetch } from '@/lib/csrf/client';
import { Icon } from '@/components/ui/ds-icon';

/* ── Types ── */

type SectionState = 'draft' | 'reviewed' | 'approved';

const STATE_BADGE_STYLES: Record<SectionState | 'failed', string> = {
  draft: 'bg-primary-fixed text-primary',
  reviewed: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
};

const STATE_BORDER_STYLES: Record<SectionState | 'failed', string> = {
  draft: 'border-outline-variant/10',
  reviewed: 'border-l-4 border-l-amber-500 border-outline-variant/10',
  approved: 'border-l-4 border-l-emerald-500 border-outline-variant/10',
  failed: 'border-l-4 border-l-red-500 border-outline-variant/10',
};

interface VersionRow {
  id: string;
  version: number;
  content: string;
  contentHash: string;
  title: string;
  metadata: Record<string, unknown>;
  reason: string;
  createdAt: string;
  createdBy: string;
}

interface StateTransitionRow {
  timestamp: string;
  userId: string;
  currentVersion: number;
  fromState: 'draft' | 'reviewed' | 'approved';
  toState: 'draft' | 'reviewed' | 'approved';
  reason: string | null;
  reviewSkipped: boolean;
}

interface TimelineEntry {
  kind: 'version' | 'transition';
  timestamp: string;
  payload: VersionRow | StateTransitionRow;
}

/* ── SectionHistoryPanel ── */

function SectionHistoryPanel({
  sessionId,
  sectionId,
  currentVersion,
  onRollback,
  onClose,
  t,
}: {
  sessionId: string;
  sectionId: string;
  currentVersion: number;
  onRollback: (targetVersion: number) => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [transitions, setTransitions] = useState<StateTransitionRow[]>([]);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [comparingVersion, setComparingVersion] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ai/orchestrator/sessions/${sessionId}/sections/${sectionId}/versions`);
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setVersions(data.versions ?? []);
        setTransitions(data.stateTransitions ?? []);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, sectionId, currentVersion]);

  const currentContent = versions.find((v) => v.version === currentVersion)?.content ?? '';

  const timeline: TimelineEntry[] = [
    ...versions.map<TimelineEntry>((v) => ({ kind: 'version', timestamp: v.createdAt, payload: v })),
    ...transitions.map<TimelineEntry>((tr) => ({ kind: 'transition', timestamp: tr.timestamp, payload: tr })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (loading) {
    return (
      <div className="mt-3 p-4 bg-surface-container-lowest border border-outline-variant/10 rounded-lg text-xs text-on-surface-variant">
        {t('proposalTab.historyLoading')}
      </div>
    );
  }

  return (
    <div className="mt-3 p-4 bg-surface-container-lowest border border-outline-variant/15 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h6 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          {t('proposalTab.historyTitle', { count: versions.length })}
        </h6>
        <button
          onClick={onClose}
          className="text-xs text-on-surface-variant hover:text-on-surface"
        >
          ×
        </button>
      </div>

      <div className="space-y-2">
        {timeline.map((entry, idx) => {
          if (entry.kind === 'version') {
            const v = entry.payload as VersionRow;
            const isCurrent = v.version === currentVersion;
            return (
              <div key={`v-${v.id}`} className={`p-3 rounded-lg border ${isCurrent ? 'border-primary border-2 bg-primary/5' : 'border-outline-variant/10 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-on-surface">{t('proposalTab.historyVersionLabel', { version: v.version })}</span>
                    {isCurrent && <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary text-white font-bold uppercase">{t('proposalTab.historyCurrent')}</span>}
                  </div>
                  <span className="text-[10px] text-on-surface-variant">{new Date(v.createdAt).toLocaleString()}</span>
                </div>
                {v.reason && (
                  <div className="mt-1 text-[11px] text-on-surface-variant italic">
                    {v.reason === 'initial_generation' ? t('proposalTab.historyReasonInitialGeneration') : v.reason}
                  </div>
                )}
                {!isCurrent && (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={() => setViewingVersion(viewingVersion === v.version ? null : v.version)}
                      className="text-[10px] px-2 py-1 rounded border border-primary/20 text-primary hover:bg-primary/5"
                    >
                      {t('proposalTab.historyActionView')}
                    </button>
                    <button
                      onClick={() => setComparingVersion(comparingVersion === v.version ? null : v.version)}
                      className="text-[10px] px-2 py-1 rounded border border-primary/20 text-primary hover:bg-primary/5"
                    >
                      {t('proposalTab.historyActionCompare')}
                    </button>
                    <button
                      onClick={() => {
                        const confirmed = window.confirm(t('proposalTab.rollbackConfirm', { version: v.version }));
                        if (confirmed) onRollback(v.version);
                      }}
                      className="text-[10px] px-2 py-1 rounded border border-amber-200 text-amber-700 hover:bg-amber-50"
                    >
                      {t('proposalTab.historyActionRollback')}
                    </button>
                  </div>
                )}
                {viewingVersion === v.version && !isCurrent && (
                  <div className="mt-3 p-3 bg-surface-container-low rounded text-xs text-on-surface whitespace-pre-wrap border border-outline-variant/10 max-h-60 overflow-y-auto">
                    {v.content}
                  </div>
                )}
                {comparingVersion === v.version && !isCurrent && (
                  <div className="mt-3 p-3 bg-surface-container-low rounded text-xs border border-outline-variant/10 max-h-60 overflow-y-auto">
                    {diffWordsWithSpace(v.content, currentContent).map((part, i) => (
                      <span
                        key={i}
                        className={part.added ? 'bg-emerald-100 text-emerald-900' : part.removed ? 'bg-red-100 text-red-900 line-through' : 'text-on-surface-variant'}
                      >
                        {part.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          } else {
            const tr = entry.payload as StateTransitionRow;
            return (
              <div key={`tr-${idx}`} className="p-2 rounded bg-surface-container-low border border-dashed border-outline-variant/20">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-on-surface-variant">
                    {t('proposalTab.stateTransitionArrow', { from: tr.fromState, to: tr.toState })}
                    {tr.reviewSkipped && <span className="ml-2 text-amber-700 italic">({t('proposalTab.stateTransitionReviewSkipped')})</span>}
                  </span>
                  <span className="text-[10px] text-outline">{new Date(tr.timestamp).toLocaleString()}</span>
                </div>
              </div>
            );
          }
        })}
      </div>
    </div>
  );
}

/* ── SectionActionButtons ── */

function SectionActionButtons({
  section,
  displayState,
  sessionId,
  onStateChange,
  onRollback: _onRollback,
  onToggleHistory,
  onRegenerate,
  isHistoryOpen,
  t,
}: {
  section: import('@/lib/ai/orchestrator/types').SectionResult;
  displayState: 'draft' | 'reviewed' | 'approved' | 'failed';
  sessionId: string | null;
  onStateChange: (sectionId: string, toState: 'draft' | 'reviewed' | 'approved', expectedCurrentVersion: number) => Promise<void>;
  onRollback: (sectionId: string, targetVersion: number, expectedCurrentVersion: number) => Promise<void>;
  onToggleHistory: (sectionId: string) => void;
  onRegenerate: (section: import('@/lib/ai/orchestrator/types').SectionResult) => void;
  isHistoryOpen: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const disabled = !sessionId;

  return (
    <div className="pt-2 border-t border-outline-variant/10 flex flex-wrap items-center gap-2">
      {displayState === 'draft' && (
        <>
          <button
            onClick={() => onStateChange(section.id, 'reviewed', section.currentVersion)}
            disabled={disabled}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-full bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {t('proposalTab.actionMarkReviewed')}
          </button>
          <button
            onClick={() => onStateChange(section.id, 'approved', section.currentVersion)}
            disabled={disabled}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {t('proposalTab.actionApprove')}
          </button>
        </>
      )}
      {displayState === 'reviewed' && (
        <>
          <button
            onClick={() => onStateChange(section.id, 'approved', section.currentVersion)}
            disabled={disabled}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {t('proposalTab.actionApprove')}
          </button>
          <button
            onClick={() => onStateChange(section.id, 'draft', section.currentVersion)}
            disabled={disabled}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50"
          >
            {t('proposalTab.actionBackToDraft')}
          </button>
        </>
      )}
      {displayState === 'approved' && (
        <button
          onClick={() => onStateChange(section.id, 'draft', section.currentVersion)}
          disabled={disabled}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50"
        >
          {t('proposalTab.actionUnapprove')}
        </button>
      )}
      {displayState === 'failed' && (
        <button
          disabled
          title={t('proposalTab.approveFailedDisabledTooltip')}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-full bg-surface-container-high text-outline cursor-not-allowed"
        >
          {t('proposalTab.actionApprove')}
        </button>
      )}

      <button
        onClick={() => onRegenerate(section)}
        disabled={disabled}
        className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50"
      >
        <Icon name={section.source === 'failed' ? 'refresh' : 'auto_awesome'} size="sm" />
        {section.source === 'failed' ? t('proposalTab.actionRegenerate') : t('proposalTab.improveSection')}
      </button>

      <button
        onClick={() => onToggleHistory(section.id)}
        disabled={disabled}
        className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50"
      >
        {isHistoryOpen ? t('proposalTab.actionCloseHistory') : t('proposalTab.actionHistory')}
      </button>
    </div>
  );
}

/* ── SectionProgressHeader ── */

function SectionProgressHeader({
  sections,
  t,
}: {
  sections: import('@/lib/ai/orchestrator/types').SectionResult[] | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!sections || sections.length === 0) return null;

  const total = sections.length;
  const approved = sections.filter((s) => s.state === 'approved').length;
  const reviewed = sections.filter((s) => s.state === 'reviewed').length;
  const draft = sections.filter((s) => s.state === 'draft').length;

  const approvedPct = (approved / total) * 100;
  const reviewedPct = (reviewed / total) * 100;
  const draftPct = (draft / total) * 100;

  return (
    <div className="sticky top-0 z-10 bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-4 mb-4 shadow-[0_8px_20px_rgba(0,0,0,0.03)]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-bold text-on-surface">{t('proposalTab.title')}</div>
          <div className="text-xs text-on-surface-variant mt-0.5">
            {t('proposalTab.progressHeader', { approved, reviewed, draft, total })}
          </div>
        </div>
        <div className="flex gap-1.5">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-fixed text-primary font-bold">{draft} {t('proposalTab.stateBadgeDraft')}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-tertiary-container/20 text-tertiary font-bold">{reviewed} {t('proposalTab.stateBadgeReviewed')}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary-container/20 text-emerald-700 font-bold">{approved} {t('proposalTab.stateBadgeApproved')}</span>
        </div>
      </div>
      <div className="h-2 rounded-full bg-surface-container-low overflow-hidden flex">
        <div className="bg-emerald-600" style={{ width: `${approvedPct}%` }} />
        <div className="bg-amber-500" style={{ width: `${reviewedPct}%` }} />
        <div className="bg-primary" style={{ width: `${draftPct}%` }} />
      </div>
      <div className="mt-2 text-[10px] text-on-surface-variant italic">
        {t('proposalTab.progressCaption', { total })}
      </div>
    </div>
  );
}

/* ── ProposalTabContent (exported) ── */

export function ProposalTabContent({
  proposalSections,
  sendMessage,
  activeSessionId,
  t,
}: {
  proposalSections: import('@/lib/ai/orchestrator/types').SectionResult[] | null;
  sendMessage: (msg: string) => void;
  activeSessionId: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const [expandedHistorySection, setExpandedHistorySection] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);
  const [sectionVersioningEnabled, setSectionVersioningEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!activeSessionId || !proposalSections || proposalSections.length === 0) {
      setSectionVersioningEnabled(false);
      return;
    }

    const firstSectionId = proposalSections[0]?.id;
    if (!firstSectionId) {
      setSectionVersioningEnabled(false);
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/ai/orchestrator/sessions/${activeSessionId}/sections/${firstSectionId}/versions`,
        );
        if (cancelled) return;
        setSectionVersioningEnabled(res.ok);
      } catch {
        if (!cancelled) setSectionVersioningEnabled(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, proposalSections]);

  const handleStateChange = async (
    sectionId: string,
    toState: 'draft' | 'reviewed' | 'approved',
    expectedCurrentVersion: number,
  ) => {
    if (!activeSessionId || mutating) return;
    setMutating(sectionId);
    try {
      await bootstrapCSRFToken();
      const res = await csrfFetch(
        `/api/ai/orchestrator/sessions/${activeSessionId}/sections/${sectionId}/state`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: toState, expectedCurrentVersion }),
        },
      );
      if (!res.ok) {
        if (res.status === 404) setSectionVersioningEnabled(false);
        const err = await res.json().catch(() => null);
        console.error('state transition failed', err);
      }
    } finally {
      setMutating(null);
    }
  };

  const handleRollback = async (sectionId: string, targetVersion: number, expectedCurrentVersion: number) => {
    if (!activeSessionId || mutating) return;
    setMutating(sectionId);
    try {
      await bootstrapCSRFToken();
      const res = await csrfFetch(
        `/api/ai/orchestrator/sessions/${activeSessionId}/sections/${sectionId}/rollback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetVersion, expectedCurrentVersion }),
        },
      );
      if (!res.ok) {
        if (res.status === 404) setSectionVersioningEnabled(false);
        const err = await res.json().catch(() => null);
        console.error('rollback failed', err);
      }
      setExpandedHistorySection(null);
    } finally {
      setMutating(null);
    }
  };

  const handleToggleHistory = (sectionId: string) => {
    setExpandedHistorySection((prev) => (prev === sectionId ? null : sectionId));
  };

  const handleRegenerate = (section: import('@/lib/ai/orchestrator/types').SectionResult) => {
    const confirmed = section.state === 'approved'
      ? window.confirm(t('proposalTab.regenerateApprovedConfirm'))
      : true;
    if (!confirmed) return;
    sendMessage(
      section.source === 'failed'
        ? `Regenerate section: ${section.title}`
        : `Improve section: ${section.title}`,
    );
  };

  if (!proposalSections) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Icon name="article" size="lg" className="text-outline mx-auto" />
          <p className="text-sm text-on-surface-variant">{t('proposalTab.waiting')}</p>
        </div>
      </div>
    );
  }

  const sortedSections = [...proposalSections].sort((a, b) => a.order - b.order);
  const versioningUiEnabled = sectionVersioningEnabled === true;

  return (
    <div className="space-y-4">
      {versioningUiEnabled && (
        <SectionProgressHeader sections={proposalSections} t={t} />
      )}
        {sortedSections
          .map((section) => {
            const displayState: SectionState | 'failed' = section.source === 'failed' ? 'failed' : section.state;
            const badgeClass = STATE_BADGE_STYLES[displayState];
            const borderClass = STATE_BORDER_STYLES[displayState];
            const badgeLabel = displayState === 'failed'
              ? t('proposalTab.stateBadgeFailed')
              : displayState === 'approved'
                ? t('proposalTab.stateBadgeApproved')
                : displayState === 'reviewed'
                  ? t('proposalTab.stateBadgeReviewed')
                  : t('proposalTab.stateBadgeDraft');

            return (
              <div
                key={section.order}
                className={`p-5 bg-surface-container-lowest rounded-xl border ${borderClass} space-y-3`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant flex-shrink-0">
                      {t('proposalTab.sectionOrder', { order: section.order })}
                    </span>
                    <h5 className="font-bold text-on-surface truncate">{section.title}</h5>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full ${badgeClass}`}>
                      {badgeLabel}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-surface-container-high text-on-surface-variant">
                      {t('proposalTab.versionPill', { version: section.currentVersion })}
                    </span>
                  </div>
                </div>

                {section.source === 'failed' ? (
                  <div className="p-3 bg-error-container/5 border border-error/10 rounded-lg">
                    <p className="text-sm text-error/80 italic">{t('proposalTab.failedHint')}</p>
                  </div>
                ) : (
                  <div className="text-sm text-on-surface-variant leading-relaxed max-h-48 overflow-y-auto">
                    {section.content}
                  </div>
                )}

                {versioningUiEnabled ? (
                  <SectionActionButtons
                    section={section}
                    displayState={displayState}
                    sessionId={activeSessionId}
                    onStateChange={handleStateChange}
                    onRollback={handleRollback}
                    onToggleHistory={handleToggleHistory}
                    onRegenerate={handleRegenerate}
                    isHistoryOpen={expandedHistorySection === section.id}
                    t={t}
                  />
                ) : (
                  <div className="pt-2 border-t border-outline-variant/10">
                    <button
                      onClick={() => sendMessage(`Improve section: ${section.title}`)}
                      disabled={!activeSessionId}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50"
                    >
                      <Icon name="auto_awesome" size="sm" />
                      {t('proposalTab.improveSection')}
                    </button>
                  </div>
                )}

                {versioningUiEnabled && expandedHistorySection === section.id && (
                  <SectionHistoryPanel
                    sessionId={activeSessionId!}
                    sectionId={section.id}
                    currentVersion={section.currentVersion}
                    onRollback={(targetVersion: number) => handleRollback(section.id, targetVersion, section.currentVersion)}
                    onClose={() => setExpandedHistorySection(null)}
                    t={t}
                  />
                )}
              </div>
            );
          })}
    </div>
  );
}
