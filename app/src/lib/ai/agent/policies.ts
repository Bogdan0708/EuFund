import type { AgentSession, AgentSection, SectionSpec } from './types'

const MIN_STRUCTURE_CONFIDENCE = 0.4
const MIN_FRESHNESS_CONFIDENCE = 0.6

interface BlueprintConfidence {
  structureConfidence?: number
  freshnessConfidence?: number
}

export interface PolicyResult {
  allowed: boolean
  reason?: string
}

export function checkPolicyGate(
  toolName: string,
  session: AgentSession,
  sections: AgentSection[],
): PolicyResult {
  switch (toolName) {
    case 'generate_section':
      return checkPreGenerate(session)
    case 'validate_application':
      return checkPreComplete(session, sections)
    default:
      return { allowed: true }
  }
}

function checkPreGenerate(session: AgentSession): PolicyResult {
  const blueprint = session.blueprint as (BlueprintConfidence & object) | null

  if (session.outline === null) {
    return { allowed: false, reason: 'Cannot generate: outline must be approved first' }
  }
  if (session.eligibility && session.eligibility.failCount > 0) {
    return { allowed: false, reason: 'Cannot generate: eligibility has hard blockers' }
  }
  if (blueprint?.structureConfidence != null && blueprint.structureConfidence < MIN_STRUCTURE_CONFIDENCE) {
    return { allowed: false, reason: `Cannot generate: structure confidence too low (< ${MIN_STRUCTURE_CONFIDENCE})` }
  }
  return { allowed: true }
}

function checkPreComplete(session: AgentSession, sections: AgentSection[]): PolicyResult {
  const blueprint = session.blueprint as (BlueprintConfidence & object) | null

  if (!session.outline) {
    return { allowed: false, reason: 'Cannot complete: no outline exists' }
  }
  const mandatoryKeys = (session.outline as SectionSpec[])
    .filter(s => s.mandatory !== false)
    .map(s => s.id)
  const acceptedKeys = new Set(sections.filter(s => s.status === 'accepted').map(s => s.sectionKey))
  const missing = mandatoryKeys.filter(k => !acceptedKeys.has(k))
  if (missing.length > 0) {
    return { allowed: false, reason: `Cannot complete: mandatory sections not accepted: ${missing.join(', ')}` }
  }
  if (blueprint?.freshnessConfidence != null && blueprint.freshnessConfidence < MIN_FRESHNESS_CONFIDENCE) {
    return { allowed: false, reason: 'Cannot complete: freshness confidence too low — refresh call status first' }
  }
  return { allowed: true }
}

export interface InvalidationEffects {
  clearBlueprint: boolean
  clearEligibility: boolean
  clearOutline: boolean
  invalidateAllSections: boolean
  markSectionsStale: boolean
  staleSectionKeys?: string[]
}

export function getInvalidationEffects(event: string): InvalidationEffects {
  switch (event) {
    case 'call_changed':
      return { clearBlueprint: true, clearEligibility: true, clearOutline: true, invalidateAllSections: true, markSectionsStale: false }
    case 'structure_changed':
      return { clearBlueprint: false, clearEligibility: false, clearOutline: false, invalidateAllSections: false, markSectionsStale: true }
    default:
      return { clearBlueprint: false, clearEligibility: false, clearOutline: false, invalidateAllSections: false, markSectionsStale: false }
  }
}
