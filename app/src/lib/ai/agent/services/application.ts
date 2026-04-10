// ── Application State Service ─────────────────────────────────────────────
// Load full application state and run deterministic validation rules.
// Enforces session ownership so callers cannot cross tenant boundaries.
//
// Layer rule: import only from @/lib/db, @/lib/db/schema, drizzle-orm,
// ./errors, and ./types. No V3 or MCP imports.

import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { NotFoundError } from './errors'
import type {
  ServiceContext,
  ApplicationState,
  ApplicationValidationResult,
  ValidationIssue,
  AnnexChecklistItem,
  EligibilityDecision,
} from './types'

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
  const draftKeys = new Set(
    sectionRows.filter(r => r.status === 'draft' || r.status === 'needs_review').map(r => r.sectionKey),
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

  const totalSections = sectionRows.length
  const acceptedSections = sectionRows.filter(r => r.status === 'accepted').length
  const draftSections = sectionRows.filter(r => r.status === 'draft' || r.status === 'generating').length
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
