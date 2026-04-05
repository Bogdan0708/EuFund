'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { diffWordsWithSpace } from 'diff';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { Icon } from '@/components/ui/ds-icon';
import { canvasSlideIn } from '@/lib/motion';

/* ────────────────────────────────────────────────────────────────── */
/*  Step Progress Bar                                                */
/* ────────────────────────────────────────────────────────────────── */

function StepProgressBar({
  currentStep,
  t,
}: {
  currentStep: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const totalSteps = 5;

  return (
    <div className="flex items-center w-full px-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isCompleted = step < currentStep;
        const isCurrent = step === currentStep;

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            {/* Dot */}
            <div className="flex flex-col items-center gap-1.5 relative">
              <div
                className={`
                  w-3 h-3 rounded-full transition-all duration-300
                  ${isCompleted ? 'bg-primary scale-100' : ''}
                  ${isCurrent ? 'bg-primary ring-4 ring-primary/20 animate-pulse scale-125' : ''}
                  ${!isCompleted && !isCurrent ? 'bg-surface-container-highest scale-100' : ''}
                `}
              />
              <span
                className={`
                  text-[9px] font-bold uppercase tracking-widest whitespace-nowrap absolute top-5
                  ${isCurrent ? 'text-primary' : isCompleted ? 'text-on-surface' : 'text-on-surface-variant opacity-40'}
                `}
              >
                {t(`steps.${step}` as Parameters<typeof t>[0])}
              </span>
            </div>
            {/* Connector line */}
            {step < totalSteps && (
              <div
                className={`
                  flex-1 h-[2px] mx-1 transition-colors duration-300
                  ${step < currentStep ? 'bg-primary' : 'bg-surface-container-high'}
                `}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Checkpoint Renderers                                             */
/* ────────────────────────────────────────────────────────────────── */

function CheckpointSelect({
  options,
  onSelect,
  disabled,
}: {
  options: { id: string; label: string; description?: string }[];
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 mt-3">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onSelect(opt.id, opt.label)}
          disabled={disabled}
          className="text-left p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/10 hover:border-primary/30 hover:bg-primary-fixed/5 transition-all duration-200 group disabled:opacity-50 disabled:pointer-events-none"
        >
          <span className="font-medium text-on-surface group-hover:text-primary transition-colors">
            {opt.label}
          </span>
          {opt.description && (
            <p className="text-xs text-on-surface-variant mt-1">
              {opt.description}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}

function CheckpointConfirm({
  onContinue,
  onModify,
  disabled,
  t,
}: {
  onContinue: () => void;
  onModify: () => void;
  disabled?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex gap-3 mt-3">
      <button
        onClick={onContinue}
        disabled={disabled}
        className="px-5 py-2 bg-primary-container text-white text-sm font-bold rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {t('checkpoint.continue')}
      </button>
      <button
        onClick={onModify}
        disabled={disabled}
        className="px-5 py-2 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-full transition-colors disabled:opacity-50"
      >
        {t('checkpoint.modify')}
      </button>
    </div>
  );
}

function CheckpointFreetext({
  onSend,
  disabled,
  t,
}: {
  onSend: (text: string) => Promise<boolean>;
  disabled?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [text, setText] = useState('');

  const handleSend = async () => {
    if (!text.trim() || disabled) return;
    const ok = await onSend(text.trim());
    if (ok) setText('');
  };

  return (
    <div className="flex gap-2 mt-3">
      <input
        className="flex-1 bg-surface-container-lowest rounded-full py-2.5 px-4 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 text-sm"
        placeholder={t('checkpoint.typeResponse')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSend();
        }}
        disabled={disabled}
      />
      <button
        disabled={!text.trim() || disabled}
        onClick={handleSend}
        className="px-5 py-2 bg-primary-container text-white text-sm font-bold rounded-full hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {t('checkpoint.sendResponse')}
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Canvas Tabs                                                       */
/* ────────────────────────────────────────────────────────────────── */

function TabBar({
  activeTab,
  onTabChange,
  t,
}: {
  activeTab: 'calls' | 'plan' | 'proposal';
  onTabChange: (tab: 'calls' | 'plan' | 'proposal') => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tabs: ('calls' | 'plan' | 'proposal')[] = ['calls', 'plan', 'proposal'];

  return (
    <div className="flex border-b border-surface-container-low">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className={`
            flex-1 py-3 text-sm font-bold tracking-wide transition-all duration-200
            ${
              activeTab === tab
                ? 'text-primary border-b-2 border-primary'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
            }
          `}
        >
          {t(`tabs.${tab}` as Parameters<typeof t>[0])}
        </button>
      ))}
    </div>
  );
}

function CallsTabContent({
  matchedCalls,
  t,
}: {
  matchedCalls: import('@/lib/ai/orchestrator/types').MatchedCall[] | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!matchedCalls) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Icon name="search" size="lg" className="text-outline mx-auto" />
          <p className="text-sm text-on-surface-variant">{t('callsTab.waiting')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
        {t('callsTab.title')}
      </h4>
      {matchedCalls.map((call) => (
        <div
          key={call.callId}
          className="p-5 bg-surface-container-lowest rounded-xl border border-outline-variant/10 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h5 className="font-bold text-on-surface leading-tight">{call.title}</h5>
              <span className="inline-block mt-1.5 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-primary-fixed text-primary rounded-full">
                {call.program}
              </span>
            </div>
            <div className="text-right shrink-0">
              <span className="text-2xl font-bold text-primary">{Math.round(call.score * 100)}%</span>
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                {t('callsTab.score')}
              </p>
            </div>
          </div>

          {/* Fit breakdown */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t('callsTab.thematicFit'), value: call.thematicFit },
              { label: t('callsTab.eligibilityFit'), value: call.eligibilityFit },
              { label: t('callsTab.budgetFit'), value: call.budgetFit },
            ].map((fit) => (
              <div key={fit.label} className="text-center">
                <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.round(fit.value * 100)}%` }}
                  />
                </div>
                <span className="text-[9px] font-medium text-on-surface-variant mt-1 block">
                  {fit.label}
                </span>
              </div>
            ))}
          </div>

          {call.deadline && (
            <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <Icon name="schedule" size="sm" />
              <span>{t('callsTab.deadline')}: {call.deadline}</span>
            </div>
          )}

          {call.reasoning && (
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {call.reasoning}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function PlanTabContent({
  actionPlan,
  t,
}: {
  actionPlan: import('@/lib/ai/orchestrator/types').ActionPlan | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!actionPlan) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Icon name="checklist" size="lg" className="text-outline mx-auto" />
          <p className="text-sm text-on-surface-variant">{t('planTab.waiting')}</p>
        </div>
      </div>
    );
  }

  const categoryIcons: Record<string, string> = {
    document: 'description',
    approval: 'verified',
    registration: 'app_registration',
    writing: 'edit_note',
    budget: 'account_balance',
  };

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          {t('planTab.title')}
        </h4>
        {actionPlan.estimatedTimeline && (
          <p className="text-xs text-on-surface-variant mt-1">
            {t('planTab.timeline')}: {actionPlan.estimatedTimeline}
          </p>
        )}
      </div>

      {/* Steps list */}
      <div className="space-y-3">
        {actionPlan.steps
          .sort((a, b) => a.order - b.order)
          .map((step) => (
            <div
              key={step.order}
              className="flex gap-3 p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/10"
            >
              <div className="w-7 h-7 rounded-full bg-primary-fixed text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {step.order}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h5 className="font-bold text-sm text-on-surface">{step.title}</h5>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-surface-container-high text-on-surface-variant rounded-full">
                    <Icon name={categoryIcons[step.category] || 'label'} size="sm" />
                    {t(`planTab.categories.${step.category}` as Parameters<typeof t>[0])}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                  {step.description}
                </p>
                {step.deadline && (
                  <div className="flex items-center gap-1 text-[10px] text-on-surface-variant mt-1.5">
                    <Icon name="schedule" size="sm" />
                    {step.deadline}
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>

      {/* Required documents */}
      {actionPlan.requiredDocuments.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            {t('planTab.requiredDocs')}
          </h4>
          {actionPlan.requiredDocuments.map((doc, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-3 bg-surface-container-lowest rounded-xl border border-outline-variant/10"
            >
              <div className="flex items-center gap-2">
                <Icon name="description" size="sm" className="text-on-surface-variant" />
                <div>
                  <span className="text-sm font-medium text-on-surface">{doc.name}</span>
                  <p className="text-[10px] text-on-surface-variant">
                    {t('planTab.source')}: {doc.source}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`
                    px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full
                    ${doc.mandatory ? 'bg-error-container text-on-error-container' : 'bg-surface-container-high text-on-surface-variant'}
                  `}
                >
                  {doc.mandatory ? t('planTab.mandatory') : t('planTab.optional')}
                </span>
                <p className="text-[10px] text-on-surface-variant mt-0.5">
                  {t('planTab.estimatedTime')}: {doc.estimatedTime}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  }, [sessionId, sectionId]);

  const currentContent = versions.find((v) => v.version === currentVersion)?.content ?? '';

  const timeline: TimelineEntry[] = [
    ...versions.map<TimelineEntry>((v) => ({ kind: 'version', timestamp: v.createdAt, payload: v })),
    ...transitions.map<TimelineEntry>((tr) => ({ kind: 'transition', timestamp: tr.timestamp, payload: tr })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // newest first

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

function ProposalTabContent({
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
  const [sectionVersioningEnabled, setSectionVersioningEnabled] = useState(true);

  const handleStateChange = async (
    sectionId: string,
    toState: 'draft' | 'reviewed' | 'approved',
    expectedCurrentVersion: number,
  ) => {
    if (!activeSessionId || mutating) return;
    setMutating(sectionId);
    try {
      const res = await fetch(
        `/api/ai/orchestrator/sessions/${activeSessionId}/sections/${sectionId}/state`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: toState, expectedCurrentVersion }),
        },
      );
      if (!res.ok) {
        if (res.status === 404) {
          // Feature flag is off — degrade gracefully to pre-Phase-1 UI
          setSectionVersioningEnabled(false);
        }
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
      const res = await fetch(
        `/api/ai/orchestrator/sessions/${activeSessionId}/sections/${sectionId}/rollback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetVersion, expectedCurrentVersion }),
        },
      );
      if (!res.ok) {
        if (res.status === 404) {
          // Feature flag is off — degrade gracefully to pre-Phase-1 UI
          setSectionVersioningEnabled(false);
        }
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

  return (
    <div className="space-y-4">
      {sectionVersioningEnabled && (
        <SectionProgressHeader sections={proposalSections} t={t} />
      )}
        {proposalSections
          .sort((a, b) => a.order - b.order)
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

                {sectionVersioningEnabled ? (
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

                {sectionVersioningEnabled && expandedHistorySection === section.id && (
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

/* ────────────────────────────────────────────────────────────────── */
/*  Streaming dots indicator                                         */
/* ────────────────────────────────────────────────────────────────── */

function StreamingDots() {
  return (
    <div className="flex items-start max-w-[85%]">
      <div className="glass-card px-5 py-4 rounded-[1rem] rounded-tl-none shadow-[0_20px_40px_rgba(0,0,0,0.04)] border border-white/20">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Inner Page (uses useSearchParams)                                */
/* ────────────────────────────────────────────────────────────────── */

function AsistentAIInner({ locale }: { locale: string }) {
  const t = useTranslations('aiAssistant');
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState('');
  const [modifyingCheckpointId, setModifyingCheckpointId] = useState<string | null>(null);
  const [manualTab, setManualTab] = useState<'calls' | 'plan' | 'proposal' | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    currentStep,
    status,
    sendMessage,
    activeSessionId,
    isStreaming,
    startNewSession,
    resumeSession,
    cancelPendingAutoApprove,
    error,
    canvasState,
  } = useOrchestrator(locale);

  // Resume session from URL param on mount
  useEffect(() => {
    const sessionId = searchParams.get('session');
    if (sessionId) {
      resumeSession(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Reset manual tab override only when a new step starts (not on every canvas update)
  // This prevents pulling users away from a panel they're actively reviewing
  useEffect(() => {
    setManualTab(null);
  }, [currentStep]);

  const handleSend = async () => {
    if (!inputValue.trim() || isStreaming) return;
    const sent = inputValue.trim();
    const ok = await sendMessage(sent);
    if (ok) setInputValue('');
  };

  const showCanvas = currentStep >= 2;
  const activeTab = manualTab ?? canvasState.activeTab;

  return (
    <div className="flex flex-row h-[calc(100vh-4rem)] gap-6 fade-in-up -m-6">
      {/* ── Left Panel: Chat Interface ── */}
      <section
        className={`${showCanvas ? 'w-[55%]' : 'w-full'} flex flex-col bg-surface-container-low rounded-[1rem] relative overflow-hidden ai-halo transition-all duration-500`}
      >
        {/* Chat Header */}
        <div className="px-8 py-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-secondary-container/10 flex items-center justify-center">
              <Icon name="auto_awesome" filled className="text-secondary" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                {t('curatorTitle')}
              </h2>
              <p className="text-xs text-on-surface-variant">
                {t('curatorContext')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === 'connecting' && (
              <span className="text-xs text-on-surface-variant animate-pulse">
                {t('connecting')}
              </span>
            )}
            <button
              onClick={startNewSession}
              className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-colors"
              title={t('newSession')}
            >
              <Icon name="add" />
            </button>
          </div>
        </div>

        {/* Step Progress Bar */}
        {currentStep > 0 && (
          <div className="px-8 pb-4">
            <StepProgressBar currentStep={currentStep} t={t} />
          </div>
        )}

        {/* Error Banner */}
        {status === 'error' && error && (
          <div className="mx-8 mb-4 p-4 bg-error-container/10 border border-error/20 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="error" filled className="text-error" />
              <span className="text-sm text-error">{error}</span>
            </div>
            <button
              onClick={() => startNewSession()}
              className="px-4 py-1.5 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-full transition-colors"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {/* Chat Messages Area */}
        <div className="flex-1 overflow-y-auto px-8 py-4 space-y-6">
          {/* Empty state */}
          {messages.length === 0 && !isStreaming && (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary-fixed/10 flex items-center justify-center">
                  <Icon name="chat" size="lg" className="text-primary" />
                </div>
                <p className="text-on-surface-variant text-lg">
                  {t('emptyState')}
                </p>
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => {
            // User messages — right-aligned blue pill
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex flex-col items-end w-full">
                  <div className="bg-primary-container text-white px-6 py-4 rounded-full max-w-[70%] shadow-lg shadow-primary/10">
                    <p className="text-[15px]">{msg.content}</p>
                  </div>
                  <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant opacity-40 mr-1">
                    {t('you')}
                  </span>
                </div>
              );
            }

            // Step start — centered label
            if (msg.eventType === 'step_start') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-surface-container-high/50 rounded-full">
                    <Icon name="arrow_forward" size="sm" className="text-primary" />
                    <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">
                      {msg.content}
                    </span>
                  </div>
                </div>
              );
            }

            // Step progress — subtle progress message
            if (msg.eventType === 'step_progress') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <span className="text-xs text-on-surface-variant italic">
                    {msg.content}
                  </span>
                </div>
              );
            }

            // Error — red error card
            if (msg.eventType === 'error') {
              return (
                <div key={msg.id} className="flex flex-col items-start max-w-[85%]">
                  <div className="p-4 rounded-[1rem] rounded-tl-none bg-error-container/10 border border-error/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon name="error" filled size="sm" className="text-error" />
                      <span className="text-xs font-bold text-error uppercase tracking-widest">
                        {t('errorBanner')}
                      </span>
                    </div>
                    <p className="text-sm text-error">{msg.content}</p>
                  </div>
                </div>
              );
            }

            // Checkpoint — interactive card
            if (msg.eventType === 'checkpoint' && msg.checkpoint) {
              const cp = msg.checkpoint;
              return (
                <div key={msg.id} className="flex flex-col items-start max-w-[85%]">
                  <div className="glass-card p-6 rounded-[1rem] rounded-tl-none shadow-[0_20px_40px_rgba(0,0,0,0.04)] border border-primary/20">
                    <div className="flex items-center gap-2 mb-3">
                      <Icon name="help" filled size="sm" className="text-primary" />
                      <span className="text-xs font-bold text-primary uppercase tracking-widest">
                        {t('stepLabel', { step: msg.step ?? '' })}
                      </span>
                    </div>
                    <p className="text-[15px] text-on-surface leading-relaxed">{cp.question}</p>

                    {cp.type === 'select' && cp.options && (
                      <CheckpointSelect
                        options={cp.options}
                        onSelect={(id, label) => { sendMessage(id, label); }}
                        disabled={isStreaming}
                      />
                    )}

                    {cp.type === 'confirm' && (
                      <>
                        {modifyingCheckpointId === msg.id ? (
                          <CheckpointFreetext
                            onSend={async (text) => {
                              const ok = await sendMessage(text);
                              if (ok) setModifyingCheckpointId(null);
                              return ok;
                            }}
                            disabled={isStreaming}
                            t={t}
                          />
                        ) : (
                          <CheckpointConfirm
                            onContinue={() => { sendMessage('continue'); }}
                            onModify={() => {
                              // Cancel any pending auto-approve so it doesn't
                              // fire underneath the freetext override the user
                              // is about to type.
                              cancelPendingAutoApprove();
                              setModifyingCheckpointId(msg.id);
                            }}
                            disabled={isStreaming}
                            t={t}
                          />
                        )}
                      </>
                    )}

                    {cp.type === 'freetext' && (
                      <CheckpointFreetext onSend={(text) => sendMessage(text)} disabled={isStreaming} t={t} />
                    )}
                  </div>
                  <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant opacity-40 ml-1">
                    {t('aiCurator')}
                  </span>
                </div>
              );
            }

            // Completion summary card
            if (msg.eventType === 'done') {
              const sections = canvasState.proposalSections;
              const total = sections?.length ?? 0;
              const failed = sections?.filter((s) => s.source === 'failed').length ?? 0;
              const generated = total - failed;
              // msg.content carries completionStatus from the backend (e.g. 'complete', 'needs_review', 'complete_with_gaps')
              const completionStatus = msg.content || 'complete';
              const hasIssues = failed > 0 || completionStatus === 'needs_review' || completionStatus === 'complete_with_gaps';

              return (
                <div key={msg.id} className="flex flex-col items-start max-w-[85%]">
                  <div className={`p-6 rounded-[1rem] rounded-tl-none space-y-3 ${hasIssues ? 'bg-tertiary-container/10 border border-tertiary/20' : 'bg-primary-fixed/10 border border-primary/20'}`}>
                    <div className="flex items-center gap-2">
                      <Icon name={hasIssues ? 'info' : 'check_circle'} filled size="sm" className={hasIssues ? 'text-tertiary' : 'text-primary'} />
                      <span className={`text-xs font-bold uppercase tracking-widest ${hasIssues ? 'text-tertiary' : 'text-primary'}`}>
                        {hasIssues ? t('completion.titleReview') : t('completion.title')}
                      </span>
                    </div>
                    <p className="text-[15px] text-on-surface leading-relaxed">
                      {failed > 0
                        ? t('completion.withErrors', { generated, failed, total })
                        : hasIssues
                          ? t('completion.needsReview', { total })
                          : t('completion.success', { total })}
                    </p>
                    {hasIssues && (
                      <p className="text-xs text-on-surface-variant">
                        {failed > 0
                          ? t('completion.failedHint')
                          : t('completion.reviewHint')}
                      </p>
                    )}
                    <p className="text-xs text-on-surface-variant">
                      {t('completion.editHint')}
                    </p>
                  </div>
                  <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant opacity-40 ml-1">
                    {t('aiCurator')}
                  </span>
                </div>
              );
            }

            // Default assistant message — left-aligned glass card
            return (
              <div key={msg.id} className="flex flex-col items-start max-w-[85%]">
                <div className="glass-card p-6 rounded-[1rem] rounded-tl-none shadow-[0_20px_40px_rgba(0,0,0,0.04)] text-on-surface border border-white/20">
                  <p className="leading-relaxed text-[15px]">{msg.content}</p>
                </div>
                <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant opacity-40 ml-1">
                  {t('aiCurator')}
                </span>
              </div>
            );
          })}

          {/* Streaming indicator */}
          {isStreaming && <StreamingDots />}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input Bar */}
        <div className="p-8 z-10">
          <div className="relative flex items-center">
            <input
              className="w-full bg-white rounded-full py-5 pl-8 pr-20 border-none focus:ring-2 focus:ring-primary/20 text-[15px] shadow-sm"
              placeholder={t('inputPlaceholder')}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend();
              }}
              disabled={isStreaming}
            />
            <div className="absolute right-4 flex items-center gap-2">
              <button
                onClick={handleSend}
                disabled={isStreaming || !inputValue.trim()}
                className="bg-primary-container text-white p-3 rounded-full flex items-center justify-center hover:translate-y-[-1px] transition-transform disabled:opacity-50 disabled:hover:translate-y-0"
              >
                <Icon name="send" filled />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Right Panel: Document Canvas ── */}
      {showCanvas && (
        <motion.section
          {...canvasSlideIn}
          className="w-[45%] flex flex-col bg-surface-container-lowest rounded-[1rem] shadow-[0_20px_40px_rgba(0,0,0,0.02)] border border-outline-variant/10 overflow-hidden"
        >
          {/* Tab Bar */}
          <div className="px-8 pt-6">
            <TabBar
              activeTab={activeTab}
              onTabChange={(tab) => setManualTab(tab)}
              t={t}
            />
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-8">
            {activeTab === 'calls' && (
              <CallsTabContent matchedCalls={canvasState.matchedCalls} t={t} />
            )}
            {activeTab === 'plan' && (
              <PlanTabContent actionPlan={canvasState.actionPlan} t={t} />
            )}
            {activeTab === 'proposal' && (
              <ProposalTabContent
                proposalSections={canvasState.proposalSections}
                sendMessage={sendMessage}
                activeSessionId={activeSessionId}
                t={t}
              />
            )}
          </div>
        </motion.section>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Page Component (wraps with Suspense for useSearchParams)         */
/* ────────────────────────────────────────────────────────────────── */

export default function AsistentAIPage({
  params,
}: {
  params: { locale: string };
}) {
  return (
    <Suspense>
      <AsistentAIInner locale={params.locale} />
    </Suspense>
  );
}
