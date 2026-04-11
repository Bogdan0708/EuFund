// ── Sections Service ───────────────────────────────────────────────────────
// Read and write access to agent sections and their versions.
// Also exposes deterministic section validation (no LLM calls).
// Enforces session ownership so callers cannot cross tenant boundaries.
//
// Layer rule: import only from @/lib/db, @/lib/db/schema, drizzle-orm,
// ./errors, ./types, and @/lib/legal/audit. No V3 or MCP imports.

import { db } from '@/lib/db'
import { agentSessions, agentSections, agentSectionVersions } from '@/lib/db/schema'
import { eq, and, max } from 'drizzle-orm'
import { NotFoundError, ConcurrencyError, ValidationError } from './errors'
import { verifySessionOwnership } from './context-helpers'
import { logAudit } from '@/lib/legal/audit'
import { assertPolicy } from '../policy/enforce'
import { POLICY_MATRIX } from '../policy/matrix'
import type { AgentSession } from '../types'
import type {
  ServiceContext,
  SectionListItem,
  SectionDetail,
  SectionValidationResult,
  ValidationIssue,
  SectionDraftSaveResult,
  SectionApproveResult,
  SectionRollbackResult,
} from './types'

// Re-exported for backward compatibility with callers that imported write
// result types from this module — single source of truth is ./types.
export type {
  SectionDraftSaveResult,
  SectionApproveResult,
  SectionRollbackResult,
}

// ── Validation constants ───────────────────────────────────────────────────

// Placeholder patterns that indicate unfilled template text or AI slop
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[insert\s/i,
  /\[add\s/i,
  /\[your\s/i,
  /\[company\s?name\]/i,
  /\[project\s?name\]/i,
  /\[TBD\]/i,
  /\[TODO\]/i,
  /\[placeholder\]/i,
  /\[fill\s?in\]/i,
  /XXX/,
  /___+/,
  /\.{4,}/,
]

const MIN_LENGTHS: Record<string, number> = {
  short: 300,
  medium: 700,
  long: 1500,
}

// ── Ownership guard ────────────────────────────────────────────────────────

async function assertSessionOwnership(
  ctx: ServiceContext,
  sessionId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  if (!rows[0]) {
    throw new NotFoundError('session', sessionId)
  }
}

// ── listSections ───────────────────────────────────────────────────────────

/**
 * Lists all sections for a session, verifying ownership.
 *
 * Returns `SectionListItem[]` — no content or version history.
 * Returns empty array if the session has no sections yet.
 */
export async function listSections(
  ctx: ServiceContext,
  sessionId: string,
): Promise<SectionListItem[]> {
  await assertSessionOwnership(ctx, sessionId)

  const rows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  return rows.map(row => ({
    id: row.id,
    sessionId: row.sessionId,
    sectionKey: row.sectionKey,
    title: row.title,
    documentOrder: row.documentOrder,
    generationOrder: row.generationOrder,
    status: row.status,
    retryCount: row.retryCount,
    updatedAt: row.updatedAt,
  }))
}

// ── getSection ─────────────────────────────────────────────────────────────

/**
 * Loads a single section by session + sectionKey, verifying ownership.
 *
 * Includes full content fields and a count of version history entries.
 * Throws `NotFoundError` if the section doesn't exist.
 */
export async function getSection(
  ctx: ServiceContext,
  sessionId: string,
  sectionKey: string,
): Promise<SectionDetail> {
  await assertSessionOwnership(ctx, sessionId)

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(
      and(
        eq(agentSections.sessionId, sessionId),
        eq(agentSections.sectionKey, sectionKey),
      ),
    )
    .limit(1)

  const row = sectionRows[0]
  if (!row) {
    throw new NotFoundError('section', `${sessionId}:${sectionKey}`)
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    sectionKey: row.sectionKey,
    title: row.title,
    documentOrder: row.documentOrder,
    generationOrder: row.generationOrder,
    status: row.status,
    retryCount: row.retryCount,
    updatedAt: row.updatedAt,
    content: row.content ?? null,
    acceptedContent: row.acceptedContent ?? null,
    modelUsed: row.modelUsed ?? null,
    sourcesUsed: row.sourcesUsed ? (row.sourcesUsed as string[]) : null,
    promptVersion: row.promptVersion ?? null,
    latencyMs: row.latencyMs ?? null,
    tokenUsage: row.tokenUsage
      ? (row.tokenUsage as { input: number; output: number })
      : null,
    errorClass: row.errorClass ?? null,
  }
}

// ── validateSection ────────────────────────────────────────────────────────

/**
 * Validates a section's content with deterministic rules — no LLM calls.
 *
 * Checks:
 *   1. Content is non-empty
 *   2. Minimum length based on section's expectedLength spec
 *   3. No placeholder patterns (unfilled templates, AI slop)
 *   4. No repeated sentences
 *
 * Throws `NotFoundError` when the section does not exist in the session.
 */
export async function validateSection(
  ctx: ServiceContext,
  sessionId: string,
  sectionKey: string,
): Promise<SectionValidationResult> {
  await assertSessionOwnership(ctx, sessionId)

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(
      and(
        eq(agentSections.sessionId, sessionId),
        eq(agentSections.sectionKey, sectionKey),
      ),
    )
    .limit(1)

  const row = sectionRows[0]
  if (!row) {
    throw new NotFoundError('section', `${sessionId}:${sectionKey}`)
  }

  const content = row.content ?? ''
  const issues: ValidationIssue[] = []

  // 1. Empty check
  if (!content.trim()) {
    issues.push({ code: 'EMPTY', severity: 'error', message: 'Section has no content', sectionKey })
  }

  // 2. Minimum length check
  // The section's outline spec is not stored on the row itself — we use a
  // reasonable default of 'medium' since we can't access ctx.session here.
  const minLen = MIN_LENGTHS['medium']
  if (content.length > 0 && content.length < minLen) {
    issues.push({
      code: 'TOO_SHORT',
      severity: 'warning',
      message: `Content is ${content.length} chars, expected at least ${minLen} for medium sections`,
      sectionKey,
    })
  }

  // 3. Placeholder pattern check
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = content.match(pattern)
    if (match) {
      issues.push({
        code: 'PLACEHOLDER',
        severity: 'error',
        message: `Found placeholder text: "${match[0]}"`,
        sectionKey,
      })
      break // one placeholder report is enough
    }
  }

  // 4. Repetition check
  const sentences = content.split(/[.!?]\s+/).filter(s => s.length > 20)
  const seen = new Set<string>()
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase().trim()
    if (seen.has(normalized)) {
      issues.push({
        code: 'REPETITION',
        severity: 'warning',
        message: 'Repeated sentence detected',
        sectionKey,
      })
      break
    }
    seen.add(normalized)
  }

  const errorCount = issues.filter(i => i.severity === 'error').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const score = Math.max(0, 100 - errorCount * 30 - warningCount * 10)
  const recommendedStatus = errorCount > 0 ? 'failed' : 'needs_review'

  return { sectionKey, issues, score, recommendedStatus }
}

// ── saveSectionDraft ───────────────────────────────────────────────────────

/**
 * Upsert a section draft by (sessionId, sectionKey).
 *
 * Write contract:
 *   1. Verify session ownership
 *   2. Enforce expectedStateVersion (ConcurrencyError on mismatch)
 *   3. Upsert section, create version record, increment stateVersion
 *   4. Emit audit log
 *   5. Return { versionNumber, sectionId, newStateVersion }
 */
export async function saveSectionDraft(
  ctx: ServiceContext,
  input: {
    sessionId: string
    sectionKey: string
    content: string
    expectedStateVersion: number
  },
): Promise<SectionDraftSaveResult> {
  // 1. Verify ownership
  const session = await verifySessionOwnership(ctx, input.sessionId)

  // 2. Enforce expectedStateVersion
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // 3. Enforce policy gates (Phase 3a defense-in-depth; managed runtime relies on this in 3b)
  assertPolicy(POLICY_MATRIX.saveSectionDraft, session as unknown as AgentSession)

  const newStateVersion = session.stateVersion + 1

  // 3. Persist mutation within a transaction
  let sectionId!: string
  let versionNumber!: number

  await db.transaction(async (tx) => {
    // Upsert section
    const existing = await tx
      .select()
      .from(agentSections)
      .where(and(eq(agentSections.sessionId, input.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
      .limit(1)

    if (existing[0]) {
      sectionId = existing[0].id
      await tx
        .update(agentSections)
        .set({ content: input.content, status: 'draft', updatedAt: new Date() })
        .where(eq(agentSections.id, sectionId))
    } else {
      // Create new section with minimal required fields
      const inserted = await tx
        .insert(agentSections)
        .values({
          sessionId: input.sessionId,
          sectionKey: input.sectionKey,
          title: input.sectionKey,
          documentOrder: 0,
          generationOrder: 0,
          status: 'draft',
          content: input.content,
        })
        .returning({ id: agentSections.id })
      sectionId = inserted[0].id
    }

    // Determine next version number
    const maxVersionRow = await tx
      .select({ maxVersion: max(agentSectionVersions.versionNumber) })
      .from(agentSectionVersions)
      .where(eq(agentSectionVersions.sectionId, sectionId!))

    versionNumber = (maxVersionRow[0]?.maxVersion ?? 0) + 1

    await tx.insert(agentSectionVersions).values({
      sectionId: sectionId!,
      versionNumber: versionNumber!,
      kind: 'draft',
      content: input.content,
    })

    // Increment stateVersion on session
    await tx
      .update(agentSessions)
      .set({ stateVersion: newStateVersion, updatedAt: new Date() })
      .where(eq(agentSessions.id, input.sessionId))
  })

  // 4. Emit audit log
  await logAudit({
    userId: ctx.userId,
    action: 'project.version_save',
    resourceType: 'agent_section',
    resourceId: sectionId!,
    metadata: { sessionId: input.sessionId, sectionKey: input.sectionKey, versionNumber: versionNumber!, requestId: ctx.requestId },
  })

  // 5. Return canonical result
  return { versionNumber: versionNumber!, sectionId: sectionId!, newStateVersion }
}

// ── approveSection ─────────────────────────────────────────────────────────

/**
 * Set a section status to 'accepted', copying content to acceptedContent.
 * If already accepted, returns current state (no-op idempotent).
 *
 * Write contract:
 *   1. Verify session ownership
 *   2. Enforce expectedStateVersion
 *   3. Update section status and acceptedContent, increment stateVersion
 *   4. Emit audit log
 *   5. Return { newStateVersion }
 */
export async function approveSection(
  ctx: ServiceContext,
  input: {
    sessionId: string
    sectionKey: string
    expectedStateVersion: number
  },
): Promise<{ newStateVersion: number }> {
  // 1. Verify ownership
  const session = await verifySessionOwnership(ctx, input.sessionId)

  // 2. Enforce expectedStateVersion
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // Load the section
  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(and(eq(agentSections.sessionId, input.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
    .limit(1)

  const section = sectionRows[0]
  if (!section) {
    throw new NotFoundError('section', `${input.sessionId}:${input.sectionKey}`)
  }

  // ── Service contract: idempotent no-op ordering ──────────────────────
  // Per the Phase 3 policy matrix and idempotent no-op rule:
  //
  //   1. Idempotent no-op checks run BEFORE assertPolicy.
  //   2. If the mutation would be a no-op (here: section already accepted),
  //      return the current state unchanged — no stateVersion bump, no
  //      updatedAt change, no audit event, AND no policy error.
  //   3. Only non-idempotent paths run assertPolicy. The section state
  //      allowlist `['draft', 'needs_review']` intentionally excludes
  //      'accepted' because the idempotent short-circuit already handles
  //      that case above.
  //
  // This ordering is a deliberate design choice, not a bug.
  // ─────────────────────────────────────────────────────────────────────

  // Idempotent no-op FIRST
  if (section.status === 'accepted') {
    return { newStateVersion: session.stateVersion }
  }

  // Policy gates (outline frozen + section state allowlist).
  // Only runs for paths that will actually mutate.
  assertPolicy(POLICY_MATRIX.approveSection, session as unknown as AgentSession, { sectionState: section.status })

  const newStateVersion = session.stateVersion + 1

  // 3. Persist mutation
  await db.transaction(async (tx) => {
    await tx
      .update(agentSections)
      .set({ status: 'accepted', acceptedContent: section.content, updatedAt: new Date() })
      .where(eq(agentSections.id, section.id))

    await tx
      .update(agentSessions)
      .set({ stateVersion: newStateVersion, updatedAt: new Date() })
      .where(eq(agentSessions.id, input.sessionId))
  })

  // 4. Emit audit log
  await logAudit({
    userId: ctx.userId,
    action: 'section.state_change',
    resourceType: 'agent_section',
    resourceId: section.id,
    metadata: { sessionId: input.sessionId, sectionKey: input.sectionKey, newStatus: 'accepted', requestId: ctx.requestId },
  })

  // 5. Return canonical result
  return { newStateVersion }
}

// ── rollbackSection ────────────────────────────────────────────────────────

/**
 * Restore a section to a previous version by version number.
 * Sets status to 'draft' with the historical content.
 *
 * Write contract:
 *   1. Verify session ownership
 *   2. Enforce expectedStateVersion
 *   3. Load target version, replace content, increment stateVersion
 *   4. Emit audit log
 *   5. Return { content, restoredVersion, newStateVersion }
 */
export async function rollbackSection(
  ctx: ServiceContext,
  input: {
    sessionId: string
    sectionKey: string
    targetVersion: number
    expectedStateVersion: number
  },
): Promise<SectionRollbackResult> {
  // 1. Verify ownership
  const session = await verifySessionOwnership(ctx, input.sessionId)

  // 2. Enforce expectedStateVersion
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // 3. Enforce policy gates — outline must be frozen
  assertPolicy(POLICY_MATRIX.rollbackSection, session as unknown as AgentSession)

  // Load the section
  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(and(eq(agentSections.sessionId, input.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
    .limit(1)

  const section = sectionRows[0]
  if (!section) {
    throw new NotFoundError('section', `${input.sessionId}:${input.sectionKey}`)
  }

  // Load target version
  const versionRows = await db
    .select()
    .from(agentSectionVersions)
    .where(and(eq(agentSectionVersions.sectionId, section.id), eq(agentSectionVersions.versionNumber, input.targetVersion)))
    .limit(1)

  const targetVersionRow = versionRows[0]
  if (!targetVersionRow) {
    throw new NotFoundError('section_version', `${section.id}:v${input.targetVersion}`)
  }

  const newStateVersion = session.stateVersion + 1
  const restoredContent = targetVersionRow.content

  // Determine next version number (outside transaction to keep tx lean)
  const maxVersionRow = await db
    .select({ maxVersion: max(agentSectionVersions.versionNumber) })
    .from(agentSectionVersions)
    .where(eq(agentSectionVersions.sectionId, section.id))

  const newVersionNumber = (maxVersionRow[0]?.maxVersion ?? 0) + 1

  // 3. Persist mutation
  await db.transaction(async (tx) => {
    await tx
      .update(agentSections)
      .set({ content: restoredContent, status: 'draft', updatedAt: new Date() })
      .where(eq(agentSections.id, section.id))

    // Tag the restored snapshot as kind='rollback' and record the source version.
    // This makes rollbacks explicit in the audit trail rather than opaque content swaps.
    await tx.insert(agentSectionVersions).values({
      sectionId: section.id,
      versionNumber: newVersionNumber,
      kind: 'rollback',
      content: restoredContent,
      rolledBackFromVersion: input.targetVersion,
    })

    await tx
      .update(agentSessions)
      .set({ stateVersion: newStateVersion, updatedAt: new Date() })
      .where(eq(agentSessions.id, input.sessionId))
  })

  // 4. Emit audit log
  await logAudit({
    userId: ctx.userId,
    action: 'section.rollback',
    resourceType: 'agent_section',
    resourceId: section.id,
    metadata: { sessionId: input.sessionId, sectionKey: input.sectionKey, targetVersion: input.targetVersion, requestId: ctx.requestId },
  })

  // 5. Return canonical result
  return { content: restoredContent, restoredVersion: input.targetVersion, newStateVersion }
}

// ── rejectSection ──────────────────────────────────────────────────────────

/**
 * Set a section status to 'rejected' and record the rejection reason.
 *
 * Partial idempotency rules:
 *   - Same reason on an already-rejected section → no-op (returns current
 *     stateVersion, no DB write, no audit event).
 *   - Different reason on an already-rejected section → throws
 *     POLICY_SECTION_WRONG_STATE so rejection cannot become a stealth
 *     metadata-edit path.
 *
 * Write contract:
 *   1. Verify session ownership
 *   2. Enforce expectedStateVersion
 *   3. Idempotent no-op check (same reason)
 *   4. Reject different-reason re-reject
 *   5. Policy gate (outline frozen + allowed section state)
 *   6. Update section + increment stateVersion
 *   7. Emit audit log
 *   8. Return { newStateVersion }
 */
export async function rejectSection(
  ctx: ServiceContext,
  input: { sessionId: string; sectionKey: string; reason: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(and(eq(agentSections.sessionId, input.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
    .limit(1)

  const section = sectionRows[0]
  if (!section) {
    throw new NotFoundError('section', `${input.sessionId}:${input.sectionKey}`)
  }

  // Partial idempotency: already-rejected with same reason → no-op;
  // different reason → POLICY_SECTION_WRONG_STATE (rejection is not
  // a metadata-edit path).
  if (section.status === 'rejected') {
    if (section.rejectionReason === input.reason) {
      return { newStateVersion: session.stateVersion }
    }
    throw new ValidationError(
      'reason',
      'Section already rejected with a different reason; cannot edit rejection metadata',
      'POLICY_SECTION_WRONG_STATE',
    )
  }

  // Policy gate — outline frozen + allowed section state
  assertPolicy(POLICY_MATRIX.rejectSection, session as unknown as AgentSession, { sectionState: section.status })

  const newStateVersion = session.stateVersion + 1

  await db.transaction(async (tx) => {
    await tx.update(agentSections).set({
      status: 'rejected',
      rejectionReason: input.reason,
      updatedAt: new Date(),
    }).where(eq(agentSections.id, section.id))

    await tx.update(agentSessions).set({
      stateVersion: newStateVersion,
      updatedAt: new Date(),
    }).where(eq(agentSessions.id, input.sessionId))
  })

  await logAudit({
    userId: ctx.userId,
    action: POLICY_MATRIX.rejectSection.auditAction,
    resourceType: 'agent_section',
    resourceId: section.id,
    metadata: {
      sessionId: input.sessionId,
      sectionKey: input.sectionKey,
      reason: input.reason,
      previousStatus: section.status,
      requestId: ctx.requestId,
    },
  })

  return { newStateVersion }
}

/**
 * Transitions a section to 'stale' status.
 *
 * - Idempotent: no-op if section is already stale (returns current stateVersion).
 * - Clears `acceptedContent` when demoting from 'accepted'.
 * - Requires the outline to be frozen (POLICY_MATRIX.markSectionStale).
 * - Allowed source states: draft, needs_review, accepted.
 *
 * @throws ConcurrencyError when expectedStateVersion does not match
 * @throws NotFoundError when the section does not exist
 * @throws ValidationError(POLICY_SECTION_WRONG_STATE) when section is in a disallowed state
 */
export async function markSectionStale(
  ctx: ServiceContext,
  input: { sessionId: string; sectionKey: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(and(eq(agentSections.sessionId, input.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
    .limit(1)

  const section = sectionRows[0]
  if (!section) {
    throw new NotFoundError('section', `${input.sessionId}:${input.sectionKey}`)
  }

  // Idempotent no-op: already stale — return current version without touching DB
  if (section.status === 'stale') {
    return { newStateVersion: session.stateVersion }
  }

  // Policy gate — requires outline frozen + allowed section state
  assertPolicy(POLICY_MATRIX.markSectionStale, session as unknown as AgentSession, { sectionState: section.status })

  const newStateVersion = session.stateVersion + 1

  await db.transaction(async (tx) => {
    await tx
      .update(agentSections)
      .set({
        status: 'stale',
        acceptedContent: null, // clear the accepted snapshot on demotion
        updatedAt: new Date(),
      })
      .where(eq(agentSections.id, section.id))

    await tx
      .update(agentSessions)
      .set({ stateVersion: newStateVersion, updatedAt: new Date() })
      .where(eq(agentSessions.id, input.sessionId))
  })

  await logAudit({
    userId: ctx.userId,
    action: POLICY_MATRIX.markSectionStale.auditAction,
    resourceType: 'agent_section',
    resourceId: section.id,
    metadata: {
      sessionId: input.sessionId,
      sectionKey: input.sectionKey,
      previousStatus: section.status,
      demotedFromAccepted: section.status === 'accepted',
      requestId: ctx.requestId,
    },
  })

  return { newStateVersion }
}
