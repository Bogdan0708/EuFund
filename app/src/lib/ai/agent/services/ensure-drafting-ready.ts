// Deterministic precondition saga for /sections/generate.
//
// Walks: outline present → section selection → eligibility (run if null,
// reject on failures) → freeze (idempotent). Each step that needs user
// input returns a tagged `ok: false` result so the route can respond with
// a deterministic 409 envelope BEFORE any model call. The saga itself
// makes service calls (runEligibilityForSession, freezeOutline) but never
// invokes a model.

import type { AgentSection, AgentSession, SectionSpec } from '../types'
import type { ServiceContext } from './types'
import { ValidationError, ConcurrencyError } from './errors'
import { runEligibilityForSession, freezeOutline } from './application'

export type EnsureReadyResult =
  | { ok: true; sectionSpec: SectionSpec; stateVersion: number }
  | { ok: false; code: 'OUTLINE_NOT_READY' }
  | { ok: false; code: 'NO_SECTION_TO_GENERATE' }
  | { ok: false; code: 'ELIGIBILITY_INPUT_REQUIRED'; missing: string[] }
  | { ok: false; code: 'ELIGIBILITY_FAILED'; details: unknown }

export interface EnsureReadyArgs {
  expectedStateVersion: number
  sectionKey?: string
  projectSummary?: string
}

export async function ensureDraftingReady(
  session: AgentSession,
  args: EnsureReadyArgs,
  rows: AgentSection[],
  ctx: ServiceContext,
): Promise<EnsureReadyResult> {
  // Step 0: preflight CAS — refuse stale clients BEFORE running any
  // service write or model call. The inner services (eligibility, freeze,
  // save) each enforce their own CAS, but if eligibility was already
  // populated and outline already frozen, none of them runs and a stale
  // expectedStateVersion would only surface at saveSectionDraft time —
  // after the model already streamed. This avoids that wasted call.
  if (session.stateVersion !== args.expectedStateVersion) {
    throw new ConcurrencyError(args.expectedStateVersion, session.stateVersion)
  }

  // Step 1: outline must be present
  if (!session.outline || session.outline.length === 0) {
    return { ok: false, code: 'OUTLINE_NOT_READY' }
  }

  // Step 2: section selection
  const rowByKey = new Map(rows.map((r) => [r.sectionKey, r]))
  let target: SectionSpec | undefined
  if (args.sectionKey) {
    target = session.outline.find((s) => s.id === args.sectionKey)
    if (!target) {
      return { ok: false, code: 'NO_SECTION_TO_GENERATE' }
    }
    const row = rowByKey.get(target.id)
    if (row && row.status !== 'pending') {
      return { ok: false, code: 'NO_SECTION_TO_GENERATE' }
    }
  } else {
    const sorted = [...session.outline].sort((a, b) => a.generationOrder - b.generationOrder)
    target = sorted.find((s) => {
      const r = rowByKey.get(s.id)
      return !r || r.status === 'pending'
    })
    if (!target) {
      return { ok: false, code: 'NO_SECTION_TO_GENERATE' }
    }
  }

  // Step 3: eligibility
  let currentVersion = args.expectedStateVersion
  let eligibility = session.eligibility
  if (eligibility === null) {
    try {
      const result = await runEligibilityForSession(ctx, {
        sessionId: session.id,
        expectedStateVersion: currentVersion,
        projectSummary: args.projectSummary,
      })
      currentVersion = result.newStateVersion
      eligibility = result.decision as typeof session.eligibility
    } catch (err) {
      if (err instanceof ValidationError && err.policyCode === 'ELIGIBILITY_INPUTS_MISSING') {
        return { ok: false, code: 'ELIGIBILITY_INPUT_REQUIRED', missing: ['projectSummary'] }
      }
      throw err
    }
  }

  if (eligibility && eligibility.failCount > 0) {
    return { ok: false, code: 'ELIGIBILITY_FAILED', details: eligibility }
  }

  // Step 4: freeze (idempotent)
  if (!session.outlineFrozen) {
    const result = await freezeOutline(ctx, {
      sessionId: session.id,
      expectedStateVersion: currentVersion,
    })
    currentVersion = result.newStateVersion
  }

  return { ok: true, sectionSpec: target, stateVersion: currentVersion }
}
