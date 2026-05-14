import type { AgentSession, AgentSection, Phase, StateTransition } from './types'
import { PHASES } from './types'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'agent-transitions' })

export interface TransitionResult {
  session: AgentSession
  sections: AgentSection[]
  sectionUpsert?: {
    sectionKey: string
    content: string
    model: string
    sources: string[]
  }
}

// Phases are monotonic: discovery(0) < research(1) < structuring(2) < drafting(3) < review(4).
// Tools like search_calls historically emitted SET_PHASE: 'research' unconditionally,
// regressing phase when called from a later phase. We reject backwards transitions here
// so the state machine is the single guard, regardless of which tool emitted the request.
const PHASE_ORDER: Record<Phase, number> = PHASES.reduce(
  (acc, phase, idx) => ({ ...acc, [phase]: idx }),
  {} as Record<Phase, number>,
)

function isForwardOrSamePhase(from: Phase, to: Phase): boolean {
  return PHASE_ORDER[to] >= PHASE_ORDER[from]
}

export function applyTransition(
  session: AgentSession,
  sections: AgentSection[],
  transition: StateTransition,
): TransitionResult {
  // Clone to avoid mutation
  const s = { ...session }
  let secs = sections.map(sec => ({ ...sec }))
  let sectionUpsert: TransitionResult['sectionUpsert']

  switch (transition.type) {
    case 'SET_SELECTED_CALL':
      s.selectedCallId = transition.callId
      break

    case 'SET_BLUEPRINT':
      s.blueprint = transition.blueprint
      break

    case 'SET_ELIGIBILITY':
      s.eligibility = transition.result
      break

    case 'SET_OUTLINE':
      s.outline = transition.outline
      break

    case 'FREEZE_OUTLINE':
      s.outlineFrozen = true
      break

    case 'SET_PHASE':
      if (isForwardOrSamePhase(s.currentPhase, transition.phase)) {
        s.currentPhase = transition.phase
      } else {
        log.warn(
          { sessionId: s.id, from: s.currentPhase, to: transition.phase },
          'rejected backwards SET_PHASE transition',
        )
      }
      break

    case 'SET_WARNINGS':
      s.warnings = transition.warnings
      break

    case 'ADD_WARNING':
      s.warnings = [...s.warnings, transition.warning]
      break

    case 'SET_PLANNING_ARTIFACT':
      s.planningArtifact = { ...s.planningArtifact, ...transition.artifact }
      break

    case 'UPSERT_SECTION_DRAFT':
      sectionUpsert = {
        sectionKey: transition.sectionKey,
        content: transition.content,
        model: transition.model,
        sources: transition.sources,
      }
      // Update in-memory section if it exists — increment retryCount on regeneration
      secs = secs.map(sec =>
        sec.sectionKey === transition.sectionKey
          ? { ...sec, status: 'draft' as const, content: transition.content, modelUsed: transition.model, sourcesUsed: transition.sources, retryCount: sec.retryCount + 1 }
          : sec,
      )
      break

    case 'ACCEPT_SECTION':
      secs = secs.map(sec =>
        sec.sectionKey === transition.sectionKey
          ? { ...sec, status: 'accepted' as const, acceptedContent: sec.content }
          : sec,
      )
      break

    case 'REJECT_SECTION':
      secs = secs.map(sec =>
        sec.sectionKey === transition.sectionKey
          ? { ...sec, status: 'needs_review' as const }
          : sec,
      )
      break

    case 'MARK_SECTION_STALE':
      secs = secs.map(sec =>
        sec.sectionKey === transition.sectionKey
          ? { ...sec, status: 'stale' as const }
          : sec,
      )
      break

    case 'INVALIDATE_ALL_SECTIONS':
      secs = secs.map(sec => ({ ...sec, status: 'invalidated' as const }))
      break

    case 'SET_STATUS':
      s.status = transition.status
      break
  }

  return { session: s, sections: secs, sectionUpsert }
}
