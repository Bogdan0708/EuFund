'use client'

import { useTranslations } from 'next-intl'
import type { Phase, Warning } from '@/lib/ai/agent/types'
import type { AgentSectionState } from '@/hooks/useAgent'
import type { StructuredAction } from '@/lib/ai/agent/types'
import { BlueprintCard } from './BlueprintCard'
import { EligibilityCard } from './EligibilityCard'
import { OutlineView } from './OutlineView'
import { SectionCard } from './SectionCard'
import { ValidationSummary } from './ValidationSummary'
import { WarningsBar } from './WarningsBar'

interface Props {
  phase: Phase
  sections: AgentSectionState[]
  blueprint: unknown
  eligibility: unknown
  warnings: Warning[]
  onAction: (action: StructuredAction) => void
  // True while the agent is connecting or streaming. Disables the four
  // mutating workspace buttons (approve outline, accept/reject section,
  // mark complete) so a click cannot race the in-flight turn and 409.
  isBusy: boolean
  outlineFrozen: boolean
  actionsEnabled: boolean
  runAction: (name: string, body?: Record<string, unknown>) => Promise<unknown>
  // PR 4: invoked when the user focuses a section card — used by chat
  // to scope `save_section_draft` to a single section in the trimmed mode.
  setFocusedSectionKey?: (key: string | null) => void
  // PR 5: flag-gated Generate button — POSTs to /sections/generate SSE endpoint.
  generateEnabled?: boolean
  onGenerate?: () => Promise<void> | void
}

const PHASE_ORDER: Phase[] = ['discovery', 'research', 'structuring', 'drafting', 'review']

export function AgentWorkspace({ phase, sections, blueprint, eligibility, warnings, onAction, isBusy, outlineFrozen, actionsEnabled, runAction, setFocusedSectionKey, generateEnabled, onGenerate }: Props) {
  const t = useTranslations('agent')
  const currentIndex = PHASE_ORDER.indexOf(phase)

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Phase indicator */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          {PHASE_ORDER.map((p, i) => (
            <div key={p} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${
                p === phase
                  ? 'bg-blue-600'
                  : i < currentIndex
                    ? 'bg-green-500'
                    : 'bg-gray-300'
              }`} />
              <span className={`text-xs ${p === phase ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                {t(`phase.${p}`)}
              </span>
              {i < PHASE_ORDER.length - 1 && <span className="text-gray-300 mx-1">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Action bar — flag-gated */}
      {actionsEnabled && (
        <div className="px-4 py-2 border-b border-gray-200 bg-white flex flex-wrap gap-2">
          {phase === 'structuring' && !outlineFrozen && sections.length > 0 && (
            <button
              type="button"
              onClick={() => { runAction('freeze-outline', {}).catch(() => { /* error surfaces via useAgent.error */ }) }}
              disabled={isBusy}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('actions.freezeOutline')}
            </button>
          )}
          <button
            type="button"
            onClick={() => { runAction('export', {}).catch(() => { /* error surfaces via useAgent.error */ }) }}
            disabled={isBusy}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('actions.export')}
          </button>
          {generateEnabled && phase === 'drafting' && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => { onGenerate?.() }}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('actions.generateNextSection')}
            </button>
          )}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && <WarningsBar warnings={warnings} />}

      {/* Phase-specific content */}
      <div className="flex-1 p-4 space-y-4">
        {blueprint != null && (phase === 'research' || phase === 'structuring' || phase === 'drafting' || phase === 'review') ? (
          <BlueprintCard blueprint={blueprint} />
        ) : null}

        {eligibility != null && (phase === 'research' || phase === 'structuring') ? (
          <EligibilityCard eligibility={eligibility} />
        ) : null}

        {sections.length > 0 && phase === 'structuring' && (
          <OutlineView sections={sections} onApprove={() => onAction({ type: 'approve_outline' })} disabled={isBusy} />
        )}

        {sections.length > 0 && (phase === 'drafting' || phase === 'review') && (
          <div className="space-y-3">
            {sections
              .sort((a, b) => a.documentOrder - b.documentOrder)
              .map(section => (
                <div
                  key={section.sectionKey}
                  onClick={() => setFocusedSectionKey?.(section.sectionKey)}
                  onFocusCapture={() => setFocusedSectionKey?.(section.sectionKey)}
                  // Wrapper is interactive only to set focus; SectionCard
                  // owns its own buttons (accept/reject) which still fire.
                >
                  <SectionCard
                    section={section}
                    onAccept={() => onAction({ type: 'accept_section', sectionKey: section.sectionKey })}
                    onReject={() => onAction({ type: 'reject_section', sectionKey: section.sectionKey, reason: 'Needs revision' })}
                    disabled={isBusy}
                  />
                </div>
              ))}
          </div>
        )}

        {phase === 'review' && (
          <ValidationSummary
            sections={sections}
            eligibility={eligibility}
            onComplete={() => onAction({ type: 'mark_complete' })}
            disabled={isBusy}
          />
        )}

        {phase === 'discovery' && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg font-medium">{t('discoveryPrompt')}</p>
            <p className="text-sm mt-1">{t('discoveryHint')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
