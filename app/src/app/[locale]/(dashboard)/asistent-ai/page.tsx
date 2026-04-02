'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
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
  const totalSteps = 7;

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
}: {
  options: { id: string; label: string; description?: string }[];
  onSelect: (id: string) => void | Promise<void>;
}) {
  return (
    <div className="grid gap-3 mt-3">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onSelect(opt.id)}
          className="text-left p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/10 hover:border-primary/30 hover:bg-primary-fixed/5 transition-all duration-200 group"
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
  t,
}: {
  onContinue: () => void;
  onModify: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex gap-3 mt-3">
      <button
        onClick={onContinue}
        className="px-5 py-2 bg-primary-container text-white text-sm font-bold rounded-full hover:opacity-90 transition-opacity"
      >
        {t('checkpoint.continue')}
      </button>
      <button
        onClick={onModify}
        className="px-5 py-2 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-full transition-colors"
      >
        {t('checkpoint.modify')}
      </button>
    </div>
  );
}

function CheckpointFreetext({
  onSend,
  t,
}: {
  onSend: (text: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [text, setText] = useState('');

  return (
    <div className="flex gap-2 mt-3">
      <input
        className="flex-1 bg-surface-container-lowest rounded-full py-2.5 px-4 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 text-sm"
        placeholder={t('checkpoint.typeResponse')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            onSend(text.trim());
            setText('');
          }
        }}
      />
      <button
        disabled={!text.trim()}
        onClick={() => {
          if (text.trim()) {
            onSend(text.trim());
            setText('');
          }
        }}
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

function ProposalTabContent({
  proposalSections,
  sendMessage,
  t,
}: {
  proposalSections: import('@/lib/ai/orchestrator/types').SectionResult[] | null;
  sendMessage: (msg: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
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
      <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
        {t('proposalTab.title')}
      </h4>
      {proposalSections
        .sort((a, b) => a.order - b.order)
        .map((section) => (
          <div
            key={section.order}
            className="p-5 bg-surface-container-lowest rounded-xl border border-outline-variant/10 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  {t('proposalTab.sectionOrder', { order: section.order })}
                </span>
                <h5 className="font-bold text-on-surface">{section.title}</h5>
              </div>
              <span
                className={`
                  px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full
                  ${
                    section.source === 'generated'
                      ? 'bg-secondary-container/20 text-secondary'
                      : 'bg-primary-fixed text-primary'
                  }
                `}
              >
                {section.source === 'generated'
                  ? t('proposalTab.generated')
                  : t('proposalTab.edited')}
              </span>
            </div>

            <div className="text-sm text-on-surface-variant leading-relaxed max-h-48 overflow-y-auto scrollbar-hide">
              {section.content}
            </div>

            <div className="pt-2 border-t border-outline-variant/10">
              <button
                onClick={() => sendMessage(`Improve section: ${section.title}`)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-full transition-colors"
              >
                <Icon name="auto_awesome" size="sm" />
                {t('proposalTab.improveSection')}
              </button>
            </div>
          </div>
        ))}
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
    isStreaming,
    startNewSession,
    resumeSession,
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

  // Reset manual tab override when canvas auto-advances
  useEffect(() => {
    setManualTab(null);
  }, [canvasState.activeTab]);

  const handleSend = () => {
    if (!inputValue.trim() || isStreaming) return;
    sendMessage(inputValue.trim());
    setInputValue('');
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
        <div className="flex-1 overflow-y-auto px-8 py-4 space-y-6 scrollbar-hide">
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
                        onSelect={(id) => sendMessage(id)}
                      />
                    )}

                    {cp.type === 'confirm' && (
                      <>
                        {modifyingCheckpointId === msg.id ? (
                          <CheckpointFreetext
                            onSend={(text) => {
                              sendMessage(text);
                              setModifyingCheckpointId(null);
                            }}
                            t={t}
                          />
                        ) : (
                          <CheckpointConfirm
                            onContinue={() => sendMessage('continue')}
                            onModify={() => setModifyingCheckpointId(msg.id)}
                            t={t}
                          />
                        )}
                      </>
                    )}

                    {cp.type === 'freetext' && (
                      <CheckpointFreetext onSend={(text) => sendMessage(text)} t={t} />
                    )}
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
          <div className="flex-1 overflow-y-auto p-8 scrollbar-hide">
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
