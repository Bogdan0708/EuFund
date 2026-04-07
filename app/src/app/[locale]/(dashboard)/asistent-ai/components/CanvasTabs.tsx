'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/ds-icon';

export function TabBar({
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

export function CallsTabContent({
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

          {call.freshness && (
            <div className={`flex items-center gap-1.5 text-xs mt-1 ${
              call.freshness.status === 'verified' ? 'text-emerald-700' :
              call.freshness.status === 'stale' ? 'text-amber-700' :
              'text-on-surface-variant'
            }`}>
              <Icon name={
                call.freshness.status === 'verified' ? 'check_circle' :
                call.freshness.status === 'stale' ? 'warning' :
                'help'
              } size="sm" />
              <span>
                {call.freshness.status === 'verified' && t('freshness.verified')}
                {call.freshness.status === 'stale' && (call.freshness.warnings[0] || t('freshness.stale'))}
                {call.freshness.status === 'unknown' && t('freshness.unknown')}
              </span>
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

export function PlanTabContent({
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
