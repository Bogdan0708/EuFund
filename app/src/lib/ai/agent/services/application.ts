// ── Application State Service ─────────────────────────────────────────────
// Load full application state, run deterministic validation rules, and
// write application-level state mutations.
// Enforces session ownership so callers cannot cross tenant boundaries.
//
// Layer rule: import only from @/lib/db, @/lib/db/schema, drizzle-orm,
// ./errors, ./types, and @/lib/legal/audit. No V3 or MCP imports.

import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { NotFoundError, ConcurrencyError, ValidationError } from './errors'
import { verifySessionOwnership } from './context-helpers'
import { logAudit } from '@/lib/legal/audit'
import { assertPolicy } from '../policy/enforce'
import { POLICY_MATRIX } from '../policy/matrix'
import type { AgentSession } from '../types'
import type {
  ServiceContext,
  ApplicationState,
  ApplicationValidationResult,
  ValidationIssue,
  AnnexChecklistItem,
  EligibilityDecision,
  SetApplicationStatusResult,
  ExportSnapshot,
} from './types'

// Re-exported for backward compatibility with callers that imported write
// result types from this module — single source of truth is ./types.
export type { SetApplicationStatusResult, ExportSnapshot }

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

  // Draft counts include any in-progress or needs-attention status — matches
  // the statuses the rules engine treats as non-final in validateApplication().
  // Schema values: pending, generating, draft, accepted, stale, invalidated,
  // needs_review, failed. See lib/db/schema.ts.
  const totalSections = sectionRows.length
  const acceptedSections = sectionRows.filter(r => r.status === 'accepted').length
  const draftSections = sectionRows.filter(
    r =>
      r.status === 'draft' ||
      r.status === 'generating' ||
      r.status === 'needs_review' ||
      r.status === 'stale' ||
      r.status === 'invalidated',
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

// ── validateApplication ────────────────────────────────────────────────────

/**
 * Full deterministic validation of an application session.
 *
 * Runs all rules checks and returns a populated `ApplicationValidationResult`
 * with per-issue diagnostics and a summary. This is the rules-server
 * equivalent — it does more than `getValidationReport` (which only counts).
 *
 * Throws `NotFoundError` when the session does not exist or belongs to
 * a different user.
 */
export async function validateApplication(
  ctx: ServiceContext,
  sessionId: string,
): Promise<ApplicationValidationResult> {
  // Verify ownership and load session
  const sessionRows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  const session = sessionRows[0]
  if (!session) {
    throw new NotFoundError('session', sessionId)
  }

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  const issues: ValidationIssue[] = []

  // ── 1. Mandatory section checks ──────────────────────────────────────────
  const outline = (session.outline as Array<{ id: string; title: string; mandatory?: boolean }> | null) ?? []
  const mandatorySections = outline.filter(s => s.mandatory !== false)

  const acceptedKeys = new Set(
    sectionRows.filter(r => r.status === 'accepted').map(r => r.sectionKey),
  )
  // In-progress: exists but not yet accepted. stale/invalidated still count
  // as "exists" — they need re-work but haven't been deleted.
  const draftKeys = new Set(
    sectionRows
      .filter(
        r =>
          r.status === 'draft' ||
          r.status === 'generating' ||
          r.status === 'needs_review' ||
          r.status === 'stale' ||
          r.status === 'invalidated',
      )
      .map(r => r.sectionKey),
  )

  let missingSections = 0
  for (const spec of mandatorySections) {
    if (!acceptedKeys.has(spec.id) && !draftKeys.has(spec.id)) {
      issues.push({
        code: 'SECTION_MISSING',
        severity: 'error',
        message: `Mandatory section "${spec.title}" has not been generated`,
        sectionKey: spec.id,
      })
      missingSections++
    } else if (draftKeys.has(spec.id) && !acceptedKeys.has(spec.id)) {
      issues.push({
        code: 'SECTION_NOT_ACCEPTED',
        severity: 'warning',
        message: `Section "${spec.title}" is in draft — needs review and acceptance`,
        sectionKey: spec.id,
      })
    }
  }

  // ── 2. Eligibility blockers ──────────────────────────────────────────────
  const eligibility = session.eligibility as EligibilityDecision | null
  let eligibilityBlockers = 0

  if (eligibility) {
    if (eligibility.failCount > 0) {
      issues.push({
        code: 'ELIGIBILITY_FAIL',
        severity: 'error',
        message: `${eligibility.failCount} eligibility check(s) failed`,
      })
      eligibilityBlockers = eligibility.failCount
    }
    if (eligibility.warningCount > 0) {
      issues.push({
        code: 'ELIGIBILITY_WARN',
        severity: 'warning',
        message: `${eligibility.warningCount} eligibility warning(s)`,
      })
    }
  } else {
    issues.push({
      code: 'ELIGIBILITY_NOT_RUN',
      severity: 'warning',
      message: 'Eligibility check has not been run',
    })
  }

  // ── 3. Mandatory annexes ─────────────────────────────────────────────────
  const blueprint = session.blueprint as { mandatoryAnnexes?: string[]; freshnessConfidence?: number } | null
  const mandatoryAnnexes = blueprint?.mandatoryAnnexes ?? []

  const allContent = sectionRows
    .map(r => (r.acceptedContent || r.content || '').toLowerCase())
    .join(' ')

  let mandatoryAnnexesMissing = 0
  for (const annex of mandatoryAnnexes) {
    if (!allContent.includes(annex.toLowerCase())) {
      issues.push({
        code: 'ANNEX_MISSING',
        severity: 'warning',
        message: `Mandatory annex "${annex}" not referenced in any section`,
      })
      mandatoryAnnexesMissing++
    }
  }

  // ── 4. Freshness warning ─────────────────────────────────────────────────
  if (blueprint?.freshnessConfidence != null && blueprint.freshnessConfidence < 0.6) {
    issues.push({
      code: 'STALE_DATA',
      severity: 'warning',
      message: 'Call data freshness is low — consider refreshing before final submission',
    })
  }

  // Draft counts include any in-progress or needs-attention status — matches
  // the statuses this function treats as draftKeys above (draft, needs_review)
  // plus stale/invalidated which also require re-work before acceptance.
  const totalSections = sectionRows.length
  const acceptedSections = sectionRows.filter(r => r.status === 'accepted').length
  const draftSections = sectionRows.filter(
    r =>
      r.status === 'draft' ||
      r.status === 'generating' ||
      r.status === 'needs_review' ||
      r.status === 'stale' ||
      r.status === 'invalidated',
  ).length
  const errorIssues = issues.filter(i => i.severity === 'error')
  const passed = errorIssues.length === 0

  return {
    passed,
    issues,
    summary: {
      totalSections,
      acceptedSections,
      draftSections,
      missingSections,
      mandatoryAnnexesMissing,
      eligibilityBlockers,
    },
  }
}

// ── checkMissingAnnexes ────────────────────────────────────────────────────

/**
 * Returns the annex checklist for a session — which mandatory annexes are
 * mentioned in section content and which are missing.
 *
 * A session with no blueprint returns an empty checklist.
 * Throws `NotFoundError` when the session does not exist or belongs to
 * a different user.
 */
export async function checkMissingAnnexes(
  ctx: ServiceContext,
  sessionId: string,
): Promise<{ required: string[]; uploaded: string[]; missing: string[] }> {
  const sessionRows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  const session = sessionRows[0]
  if (!session) {
    throw new NotFoundError('session', sessionId)
  }

  const blueprint = session.blueprint as { mandatoryAnnexes?: string[] } | null
  const mandatoryAnnexes = blueprint?.mandatoryAnnexes ?? []

  if (mandatoryAnnexes.length === 0) {
    return { required: [], uploaded: [], missing: [] }
  }

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  const allContent = sectionRows
    .map(r => (r.acceptedContent || r.content || '').toLowerCase())
    .join(' ')

  const checklist: AnnexChecklistItem[] = mandatoryAnnexes.map(annex => ({
    name: annex,
    status: allContent.includes(annex.toLowerCase()) ? 'mentioned' as const : 'missing' as const,
  }))

  const mentioned = checklist.filter(a => a.status === 'mentioned').map(a => a.name)
  const missing = checklist.filter(a => a.status === 'missing').map(a => a.name)

  return {
    required: mandatoryAnnexes,
    uploaded: mentioned,
    missing,
  }
}

// ── setApplicationStatus ───────────────────────────────────────────────────

/**
 * Update the status of an agent session.
 * Allowed target statuses: 'paused' | 'completed'.
 * Setting to the current status is a no-op (idempotent).
 *
 * Write contract:
 *   1. Verify session ownership
 *   2. Enforce expectedStateVersion
 *   3. Update session status, increment stateVersion
 *   4. Emit audit log
 *   5. Return { newStateVersion }
 */
export async function setApplicationStatus(
  ctx: ServiceContext,
  input: {
    sessionId: string
    status: 'paused' | 'completed'
    expectedStateVersion: number
  },
): Promise<SetApplicationStatusResult> {
  // 1. Verify ownership
  const sessionRows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, input.sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  const session = sessionRows[0]
  if (!session) {
    throw new NotFoundError('session', input.sessionId)
  }

  // 2. Enforce expectedStateVersion
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // Idempotent: same status → no-op, return current stateVersion (no policy check, no audit)
  if (session.status === input.status) {
    return { newStateVersion: session.stateVersion }
  }

  // Policy gate
  assertPolicy(POLICY_MATRIX.setApplicationStatus, session as unknown as AgentSession)

  // Completed-specific gate: validate_application must pass
  if (input.status === 'completed') {
    const validationResult = await validateApplication(ctx, input.sessionId)
    if (!validationResult.passed) {
      throw new ValidationError(
        'validation',
        'Application cannot be marked complete: validate_application did not pass',
        'POLICY_VALIDATION_NOT_PASSED',
      )
    }
  }

  const newStateVersion = session.stateVersion + 1

  // 3. Persist mutation
  await db
    .update(agentSessions)
    .set({ status: input.status, stateVersion: newStateVersion, updatedAt: new Date() })
    .where(eq(agentSessions.id, input.sessionId))

  // 4. Emit audit log
  await logAudit({
    userId: ctx.userId,
    action: 'project.status_change',
    resourceType: 'agent_session',
    resourceId: input.sessionId,
    metadata: { previousStatus: session.status, newStatus: input.status, requestId: ctx.requestId },
  })

  // 5. Return canonical result
  return { newStateVersion }
}

// ── createExportSnapshot ───────────────────────────────────────────────────

/**
 * Create a JSON export snapshot of all accepted sections for a session.
 * Each call creates a NEW snapshot — callers should not retry blindly.
 *
 * Write contract (no stateVersion guard — non-idempotent by design):
 *   1. Verify session ownership
 *   2. Load accepted sections
 *   3. Create snapshot (in-memory JSON for now, persisted via audit log)
 *   4. Emit audit log
 *   5. Return ExportSnapshot { snapshotId, format, downloadUrl, expiresAt }
 */
export async function createExportSnapshot(
  ctx: ServiceContext,
  sessionId: string,
): Promise<ExportSnapshot> {
  // 1. Verify ownership
  const sessionRows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  const session = sessionRows[0]
  if (!session) {
    throw new NotFoundError('session', sessionId)
  }

  // 2. Load accepted sections
  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(and(eq(agentSections.sessionId, sessionId), eq(agentSections.status, 'accepted')))

  const snapshotId = crypto.randomUUID()
  const exportedAt = ctx.now.toISOString()
  const expiresAt = new Date(ctx.now.getTime() + 24 * 60 * 60 * 1000).toISOString()

  // 3. Create snapshot payload (JSON export)
  const payload = {
    snapshotId,
    sessionId,
    exportedAt,
    format: 'json' as const,
    sections: sectionRows.map(r => ({
      sectionKey: r.sectionKey,
      title: r.title,
      content: r.acceptedContent ?? r.content ?? '',
    })),
  }

  // 4. Emit audit log (snapshot metadata stored via audit)
  await logAudit({
    userId: ctx.userId,
    action: 'project.export',
    resourceType: 'agent_session',
    resourceId: sessionId,
    metadata: { snapshotId, sectionCount: sectionRows.length, requestId: ctx.requestId },
    newValue: payload,
  })

  // 5. Return ExportSnapshot
  // downloadUrl is a placeholder — a real implementation would upload to GCS/S3
  const downloadUrl = `/api/mcp/write/snapshots/${snapshotId}`

  return {
    snapshotId,
    format: 'json',
    downloadUrl,
    expiresAt,
  }
}

// ── setSelectedCall ────────────────────────────────────────────────────────

/**
 * Sets the selected call on an agent session.
 *
 * Idempotent: if the session already has the same callId, returns current
 * stateVersion without bumping it, running the policy check, or emitting audit.
 *
 * Write contract:
 *   1. Verify session ownership (canonical helper)
 *   2. Enforce expectedStateVersion (concurrency guard)
 *   3. Idempotent no-op if same callId
 *   4. Policy gate — POLICY_OUTLINE_ALREADY_FROZEN
 *   5. Persist mutation + bump stateVersion
 *   6. Emit audit log as session.call_selected
 *   7. Return { newStateVersion }
 */
export async function setSelectedCall(
  ctx: ServiceContext,
  input: { sessionId: string; callId: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  // 1. Verify ownership (canonical helper)
  const session = await verifySessionOwnership(ctx, input.sessionId)

  // 2. Concurrency check
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // 3. Idempotent no-op: same callId → return current state unchanged
  if (session.selectedCallId === input.callId) {
    return { newStateVersion: session.stateVersion }
  }

  // 4. Policy gate — cannot reselect once outline is frozen
  assertPolicy(POLICY_MATRIX.setSelectedCall, session as unknown as AgentSession)

  // 5. Mutate
  const newStateVersion = session.stateVersion + 1
  await db
    .update(agentSessions)
    .set({
      selectedCallId: input.callId,
      stateVersion: newStateVersion,
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, input.sessionId))

  // 6. Audit
  await logAudit({
    userId: ctx.userId,
    action: POLICY_MATRIX.setSelectedCall.auditAction,
    resourceType: 'agent_session',
    resourceId: input.sessionId,
    metadata: { callId: input.callId, previousCallId: session.selectedCallId, requestId: ctx.requestId },
  })

  return { newStateVersion }
}

export async function freezeOutline(
  ctx: ServiceContext,
  input: { sessionId: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  // 1. Verify ownership
  const session = await verifySessionOwnership(ctx, input.sessionId)

  // 2. Concurrency check
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // 3. Idempotent no-op: already frozen
  //    (no stateVersion bump, no updatedAt change, no audit event)
  if (session.outlineFrozen) {
    return { newStateVersion: session.stateVersion }
  }

  // 4. Policy gate
  assertPolicy(POLICY_MATRIX.freezeOutline, session as unknown as AgentSession)

  // 5. Mutate: set outlineFrozen=true and advance phase to drafting
  const newStateVersion = session.stateVersion + 1
  await db
    .update(agentSessions)
    .set({
      outlineFrozen: true,
      currentPhase: 'drafting',
      stateVersion: newStateVersion,
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, input.sessionId))

  // 6. Audit
  await logAudit({
    userId: ctx.userId,
    action: POLICY_MATRIX.freezeOutline.auditAction,
    resourceType: 'agent_session',
    resourceId: input.sessionId,
    metadata: { previousPhase: session.currentPhase, requestId: ctx.requestId },
  })

  return { newStateVersion }
}
