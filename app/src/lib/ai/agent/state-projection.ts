// ── State projection ─────────────────────────────────────────────
// One helper, four consumers (state route, V3 runtime snapshot,
// managed runtime snapshot, new action endpoints). All callers see
// the same outline projection so virtual sections appear consistently
// when the blueprint is known but rows haven't been materialized.

import type {
  AgentSection,
  AgentSession,
  SectionSpec,
  UIStateSnapshot,
} from './types'
import { outlineFromBlueprint } from './services/blueprint'

type UISection = UIStateSnapshot['sections'][number]

function projectRow(row: AgentSection): UISection {
  return {
    sectionKey: row.sectionKey,
    title: row.title,
    status: row.status,
    documentOrder: row.documentOrder,
    content: row.acceptedContent ?? row.content,
  }
}

export function projectSectionsForUI(
  session: AgentSession,
  sectionRows: AgentSection[],
): UISection[] {
  // Resolve effective outline: prefer session.outline, fall back to
  // blueprint.normalized.requiredSections when outline is null but
  // blueprint exists (defense in depth for sessions that escape the
  // backfill migration).
  let outline: SectionSpec[] | null = session.outline
  if ((!outline || outline.length === 0) && session.blueprint) {
    outline = outlineFromBlueprint(session.blueprint)
  }
  if (!outline || outline.length === 0) {
    return sectionRows.map(projectRow)
  }

  const rowsByKey = new Map<string, AgentSection>()
  for (const row of sectionRows) {
    rowsByKey.set(row.sectionKey, row)
  }

  return outline.map((spec, i): UISection => {
    const row = rowsByKey.get(spec.id)
    if (row) {
      return {
        sectionKey: spec.id,
        title: spec.title,
        status: row.status,
        documentOrder: typeof spec.order === 'number' ? spec.order : i + 1,
        content: row.acceptedContent ?? row.content,
      }
    }
    return {
      sectionKey: spec.id,
      title: spec.title,
      status: 'pending',
      documentOrder: typeof spec.order === 'number' ? spec.order : i + 1,
      content: null,
    }
  })
}

export function projectSessionState(
  session: AgentSession,
  sectionRows: AgentSection[],
): UIStateSnapshot {
  return {
    sessionId: session.id,
    phase: session.currentPhase,
    stateVersion: session.stateVersion,
    outlineFrozen: session.outlineFrozen,
    warnings: session.warnings,
    sections: projectSectionsForUI(session, sectionRows),
    blueprint: session.blueprint,
    eligibility: session.eligibility,
  }
}
