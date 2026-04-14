'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { Icon } from '@/components/ui/ds-icon';
import { canvasSlideIn } from '@/lib/motion';

import { StepProgressBar } from './components/StepProgressBar';
import { CheckpointSelect, CheckpointConfirm, CheckpointFreetext } from './components/CheckpointRenderers';
import { TabBar, CallsTabContent, PlanTabContent } from './components/CanvasTabs';
import { ProposalTabContent } from './components/ProposalTab';
import { StreamingDots } from './components/StreamingDots';

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

  // Reset manual tab override only when a new step starts
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
            // User messages
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

            // Step start
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

            // Step progress
            if (msg.eventType === 'step_progress') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <span className="text-xs text-on-surface-variant italic">
                    {msg.content}
                  </span>
                </div>
              );
            }

            // Error
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

            // Checkpoint
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

            // Completion summary
            if (msg.eventType === 'done') {
              const sections = canvasState.proposalSections;
              const total = sections?.length ?? 0;
              const failed = sections?.filter((s) => s.source === 'failed').length ?? 0;
              const generated = total - failed;
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

            // Default assistant message
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
