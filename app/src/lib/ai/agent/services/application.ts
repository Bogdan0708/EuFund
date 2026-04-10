// ── Application State Service ─────────────────────────────────────────────
// Single responsibility: load the full application state for a session,
// enforcing ownership so callers cannot cross tenant boundaries.
//
// Layer rule: import only from @/lib/db, @/lib/db/schema, drizzle-orm,
// ./errors, and ./types. No V3 or MCP imports.

import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { NotFoundError } from './errors'
import type { ServiceContext, ApplicationState, ApplicationValidationResult } from './types'

// ── getApplicationState ────────────────────────────────────────────────────

/**
 * Loads the application state for a session, verifying ownership.
 *
 * Throws `NotFoundError` when:
 *   - The session does not exist.
 *   - The session exists but belongs to a different user.
 *
 * Never returns partial state — all fields are populated (sections may be []).
 */
export async function getApplicationState(
  ctx: ServiceContext,
  sessionId: string,
): Promise<ApplicationState> {
  // ── Step 1: Verify session ownership ─────────────────────────────────────
  const sessionRows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  const session = sessionRows[0]
  if (!session) {
    throw new NotFoundError('session', sessionId)
  }

  // ── Step 2: Load section statuses ─────────────────────────────────────────
  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  // ── Step 3: Assemble and return ApplicationState ──────────────────────────
  return {
    sessionId: session.id,
    phase: session.currentPhase,
    status: session.status,
    selectedCallId: session.selectedCallId ?? null,
    blueprint: (session.blueprint as ApplicationState['blueprint']) ?? null,
    eligibility: (session.eligibility as ApplicationState['eligibility']) ?? null,
    sections: sectionRows.map(row => ({
      id: row.id,
      sessionId: row.sessionId,
      sectionKey: row.sectionKey,
      title: row.title,
      documentOrder: row.documentOrder,
      generationOrder: row.generationOrder,
      status: row.status,
      retryCount: row.retryCount,
      updatedAt: row.updatedAt,
    })),
    stateVersion: session.stateVersion,
    outlineFrozen: session.outlineFrozen,
    updatedAt: session.updatedAt,
  }
}

// ── getValidationReport ────────────────────────────────────────────────────

/**
 * READ-ONLY view of application validation status.
 *
 * Counts section statuses and assembles an `ApplicationValidationResult`
 * summary. This is a snapshot — the deterministic rules engine
 * (Task 9, rules server) does the full validation; this service only
 * exposes current state counts without re-running any rules.
 *
 * Throws `NotFoundError` when the session does not exist or belongs to
 * a different user.
 */
export async function getValidationReport(
  ctx: ServiceContext,
  sessionId: string,
): Promise<ApplicationValidationResult> {
  // ── Verify session ownership ──────────────────────────────────────────────
  const sessionRows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  const session = sessionRows[0]
  if (!session) {
    throw new NotFoundError('session', sessionId)
  }

  // ── Load section statuses ─────────────────────────────────────────────────
  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  const totalSections = sectionRows.length
  const acceptedSections = sectionRows.filter(r => r.status === 'accepted').length
  const draftSections = sectionRows.filter(
    r => r.status === 'draft' || r.status === 'generating',
  ).length
  const missingSections = sectionRows.filter(
    r => r.status === 'pending' || r.status === 'failed',
  ).length

  // Eligibility blockers: fail count from stored eligibility decision
  const eligibility = session.eligibility as { failCount?: number } | null
  const eligibilityBlockers = eligibility?.failCount ?? 0

  const passed =
    totalSections > 0 &&
    acceptedSections === totalSections &&
    eligibilityBlockers === 0

  return {
    passed,
    issues: [],
    summary: {
      totalSections,
      acceptedSections,
      draftSections,
      missingSections,
      mandatoryAnnexesMissing: 0, // computed by rules server (Task 9)
      eligibilityBlockers,
    },
  }
}
