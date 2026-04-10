// ── Sections Service ───────────────────────────────────────────────────────
// Read-only access to agent sections and their versions.
// Also exposes deterministic section validation (no LLM calls).
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
  SectionListItem,
  SectionDetail,
  SectionValidationResult,
  ValidationIssue,
} from './types'

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
