'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/ds-icon';
import { DsButton } from '@/components/ui/ds-button';

/* ---------- placeholder chat data ---------- */
interface ChatMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  timestamp: string;
  isGenerating?: boolean;
  attachment?: { name: string };
}

const PLACEHOLDER_MESSAGES: ChatMessage[] = [
  {
    id: '1',
    role: 'ai',
    content:
      'Hello! I\'ve analyzed the **GreenTech Infrastructure** call requirements. Based on your current project profile, we have an 84% match. Would you like me to start drafting the Technical Methodology section or focus on the Budget Allocation strategy first?',
    timestamp: '10:24 AM',
  },
  {
    id: '2',
    role: 'user',
    content:
      'Let\'s start with the Technical Methodology. Focus on our proprietary carbon capture sensors.',
    timestamp: '10:25 AM',
  },
  {
    id: '3',
    role: 'ai',
    content:
      'Understood. I\'m aligning the sensor specifications with the EU directive for Real-time Emissions Monitoring. I\'ve populated a provisional draft in the Canvas to your right.',
    timestamp: '10:26 AM',
    isGenerating: true,
    attachment: { name: 'Methodology_Draft_V1.pdf' },
  },
];

/* ---------- workflow steps ---------- */
interface WorkflowStep {
  id: number;
  labelKey: string;
  status: 'completed' | 'active' | 'pending';
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: 1, labelKey: 'stepAnalysis', status: 'completed' },
  { id: 2, labelKey: 'stepStrategy', status: 'completed' },
  { id: 3, labelKey: 'stepDrafting', status: 'active' },
  { id: 4, labelKey: 'stepReview', status: 'pending' },
];

/* ---------- page component ---------- */
export default function AsistentAIPage() {
  const t = useTranslations('aiAssistant');
  const [inputValue, setInputValue] = useState('');

  return (
    <div className="flex flex-row h-[calc(100vh-4rem)] gap-6 fade-in-up -m-6">
      {/* ── Left Panel: Chat Interface (55%) ── */}
      <section className="w-[55%] flex flex-col bg-surface-container-low rounded-[1rem] relative overflow-hidden ai-halo">
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
          <button className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-colors">
            <Icon name="more_vert" />
          </button>
        </div>

        {/* Chat Bubbles Area */}
        <div className="flex-1 overflow-y-auto px-8 py-4 space-y-8 scrollbar-hide">
          {PLACEHOLDER_MESSAGES.map((msg) =>
            msg.role === 'ai' ? (
              <div
                key={msg.id}
                className="flex flex-col items-start max-w-[85%]"
              >
                <div className="glass-card p-6 rounded-[1rem] rounded-tl-none shadow-[0_20px_40px_rgba(0,0,0,0.04)] text-on-surface border border-white/20">
                  {msg.isGenerating && (
                    <div className="flex items-center gap-2 mb-4">
                      <Icon
                        name="sync"
                        filled
                        className="text-secondary animate-pulse"
                      />
                      <span className="text-xs font-bold text-secondary uppercase tracking-widest">
                        {t('generating')}
                      </span>
                    </div>
                  )}
                  <p className="leading-relaxed text-[15px]">{msg.content}</p>
                  {msg.attachment && (
                    <div className="mt-4 p-4 bg-surface-container-highest/30 rounded-xl border border-outline-variant/10">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {msg.attachment.name}
                        </span>
                        <Icon name="download" className="text-primary" />
                      </div>
                    </div>
                  )}
                </div>
                <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant opacity-40 ml-1">
                  {t('aiCurator')} &bull; {msg.timestamp}
                </span>
              </div>
            ) : (
              <div key={msg.id} className="flex flex-col items-end w-full">
                <div className="bg-primary-container text-white px-6 py-4 rounded-full max-w-[70%] shadow-lg shadow-primary/10">
                  <p className="text-[15px]">{msg.content}</p>
                </div>
                <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant opacity-40 mr-1">
                  {t('you')} &bull; {msg.timestamp}
                </span>
              </div>
            )
          )}
        </div>

        {/* Chat Input Bar */}
        <div className="p-8 z-10">
          <div className="relative flex items-center">
            <input
              className="w-full bg-white rounded-full py-5 pl-8 pr-32 border-none focus:ring-2 focus:ring-primary/20 text-[15px] shadow-sm"
              placeholder={t('inputPlaceholder')}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
            <div className="absolute right-4 flex items-center gap-2">
              <button className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors">
                <Icon name="attach_file" />
              </button>
              <button className="bg-primary-container text-white p-3 rounded-full flex items-center justify-center hover:translate-y-[-1px] transition-transform">
                <Icon name="send" filled />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Right Panel: Document Canvas (45%) ── */}
      <section className="w-[45%] flex flex-col bg-surface-container-lowest rounded-[1rem] shadow-[0_20px_40px_rgba(0,0,0,0.02)] border border-outline-variant/10 overflow-hidden">
        {/* Progress Header */}
        <div className="p-8 border-b border-surface-container-low">
          <div className="flex items-center justify-between mb-8">
            <h3 className="font-bold text-xl tracking-tight">
              {t('canvasTitle')}
            </h3>
            <div className="flex gap-2">
              <DsButton variant="secondary" size="sm">
                {t('saveDraft')}
              </DsButton>
              <DsButton size="sm">{t('reviewFinal')}</DsButton>
            </div>
          </div>

          {/* Workflow Progress */}
          <div className="flex items-center justify-between relative">
            <div className="absolute top-1/2 left-0 w-full h-[2px] bg-surface-container-high -translate-y-1/2 -z-0" />
            {WORKFLOW_STEPS.map((step) => (
              <div
                key={step.id}
                className={`relative z-10 flex flex-col items-center gap-2 ${
                  step.status === 'pending' ? 'opacity-30' : ''
                }`}
              >
                {step.status === 'completed' ? (
                  <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">
                    <Icon name="check" size="sm" />
                  </div>
                ) : step.status === 'active' ? (
                  <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold ring-4 ring-primary-fixed">
                    <Icon name="edit" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-surface-container-highest text-on-surface-variant flex items-center justify-center text-sm font-bold">
                    {step.id}
                  </div>
                )}
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest ${
                    step.status === 'active'
                      ? 'text-primary'
                      : 'text-on-surface'
                  }`}
                >
                  {t(step.labelKey)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Proposal Content */}
        <div className="flex-1 overflow-y-auto p-10 space-y-12">
          {/* Section 1: Project Summary */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                {t('section1Title')}
              </h4>
              <span className="px-3 py-1 text-[10px] font-bold border-2 border-yellow-400 text-yellow-700 bg-yellow-50 rounded-full uppercase">
                {t('provisional')}
              </span>
            </div>
            <div className="space-y-3">
              <div className="h-4 w-full bg-surface-container-low rounded-full" />
              <div className="h-4 w-[90%] bg-surface-container-low rounded-full" />
              <div className="h-4 w-[95%] bg-surface-container-low rounded-full" />
            </div>
          </div>

          {/* Section 2: Technical Methodology (Active Focus) */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                {t('section2Title')}
              </h4>
              <span className="px-3 py-1 text-[10px] font-bold border-2 border-yellow-400 text-yellow-700 bg-yellow-50 rounded-full uppercase">
                {t('provisional')}
              </span>
            </div>
            <div className="p-6 rounded-2xl bg-surface-container-low/50 border border-primary/10 relative">
              <div className="absolute -left-2 top-8 w-1 h-12 bg-primary rounded-full" />
              <h5 className="font-bold text-on-surface mb-3">
                {t('methodologyHeading')}
              </h5>
              <p className="text-[14px] text-on-surface-variant leading-relaxed">
                {t('methodologyContent')}
              </p>
              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="h-32 bg-surface-container-high rounded-xl flex items-center justify-center">
                  <Icon name="bar_chart" size="lg" className="text-outline" />
                </div>
                <div className="h-32 bg-surface-container-high rounded-xl flex items-center justify-center">
                  <Icon name="hub" size="lg" className="text-outline" />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Impact Assessment (Future) */}
          <div className="space-y-4 opacity-40">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-widest">
                {t('section3Title')}
              </h4>
            </div>
            <div className="space-y-3">
              <div className="h-4 w-full bg-surface-container-low rounded-full" />
              <div className="h-4 w-1/2 bg-surface-container-low rounded-full" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
