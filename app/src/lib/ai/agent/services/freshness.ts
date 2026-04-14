// ── Freshness Service ──────────────────────────────────────────────────────
// Three functions used by the eufunds-research MCP server:
//   1. refreshCallFreshness — AI-powered live status check via provider call
//   2. verifyDeadline       — deadline extraction and daysRemaining calc from DB
//   3. checkCallPageUpdates — blueprint hash comparison (DB vs provided hash)
//
// Layer rule: do NOT import from ../tools/ or ../mcp/.

import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { generate } from '@/lib/ai/providers/router'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { parseAIJson } from '../utils'
import { logger } from '@/lib/logger'
import { ExternalDependencyError, NotFoundError } from './errors'
import type { ServiceContext } from './types'
import type { FreshnessCheckResult, DeadlineVerification, CallPageDiff } from './types'

const log = logger.child({ component: 'service-freshness' })

// ── refreshCallFreshness ───────────────────────────────────────────────────

/**
 * Checks whether a funding call is still open by querying the AI provider.
 * Updates freshnessCheckedAt and freshnessConfidence in DB on success.
 * Throws ExternalDependencyError on provider or DB failure.
 */
export async function refreshCallFreshness(
  ctx: ServiceContext,
  callId: string,
): Promise<FreshnessCheckResult> {
  const start = Date.now()

  // ── Step 1: Load call metadata from DB for context ───────────────────────
  let callTitle = callId
  let program = 'Unknown'
  try {
    const rows = await db
      .select()
      .from(callKnowledge)
      .where(eq(callKnowledge.callId, callId))
      .limit(1)
    if (rows[0]) {
      callTitle = rows[0].callTitle
      program = rows[0].program
    }
  } catch (err) {
    log.warn(
      { userId: ctx.userId, callId, error: err instanceof Error ? err.message : String(err) },
      'refreshCallFreshness: DB metadata lookup failed, using callId as title',
    )
  }

  // ── Step 2: AI freshness check ────────────────────────────────────────────
  let parsed: { isOpen: boolean; amendments: string[]; warnings: string[]; confidence?: number }
  try {
    const { provider, model } = resolveAgentModel({ task: 'freshness_check' })
    const response = await generate({
      provider,
      model,
      system:
        'You verify EU funding call status. Check official Romanian sources (mfe.gov.ro, fonduri-ue.ro, MySMIS). Return JSON: { "isOpen": boolean, "amendments": string[], "warnings": string[], "confidence": number }',
      messages: [
        {
          role: 'user',
          content: `Is the following EU funding call still open for submissions? Check for recent amendments or deadline changes.\n\nCall: ${callTitle}\nProgram: ${program}\nCall ID: ${callId}`,
        },
      ],
      temperature: 0.1,
      maxTokens: 4_000,
    })

    try {
      parsed = parseAIJson(response.content)
    } catch {
      parsed = { isOpen: true, amendments: [], warnings: ['Could not parse freshness response'] }
    }
  } catch (err) {
    log.error(
      { userId: ctx.userId, callId, error: err instanceof Error ? err.message : String(err) },
      'refreshCallFreshness: AI provider call failed',
    )
    throw new ExternalDependencyError(
      'AIProvider',
      err instanceof Error ? err.message : 'Freshness AI check failed',
    )
  }

  const freshnessConfidence = parsed.confidence ?? 0.5
  const checkedAt = ctx.now.toISOString()

  // ── Step 3: Update DB ─────────────────────────────────────────────────────
  try {
    await db
      .update(callKnowledge)
      .set({
        freshnessCheckedAt: ctx.now,
        freshnessConfidence,
        updatedAt: ctx.now,
      })
      .where(eq(callKnowledge.callId, callId))
  } catch (dbErr) {
    log.warn(
      { userId: ctx.userId, callId, error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
      'refreshCallFreshness: Failed to persist freshness result to DB',
    )
    // Non-fatal: the freshness check itself succeeded, warn but don't throw
  }

  const result: FreshnessCheckResult = {
    isOpen: parsed.isOpen,
    amendments: parsed.amendments ?? [],
    warnings: parsed.warnings ?? [],
    freshnessConfidence,
    checkedAt,
  }

  log.info(
    { userId: ctx.userId, callId, isOpen: result.isOpen, confidence: freshnessConfidence, latencyMs: Date.now() - start },
    'refreshCallFreshness: check complete',
  )

  return result
}

// ── verifyDeadline ─────────────────────────────────────────────────────────

/**
 * Looks up the cached blueprint in callKnowledge, extracts deadline info,
 * and calculates daysRemaining from ctx.now.
 *
 * Returns DeadlineVerification with:
 *   - currentDeadline: ISO string or null if not found in blueprint
 *   - isOpen: true when deadline is in the future (or unknown)
 *   - warnings: any advisory messages
 *   - verifiedAt: ctx.now ISO string
 *
 * Throws NotFoundError if callId is not in callKnowledge.
 */
export async function verifyDeadline(
  ctx: ServiceContext,
  callId: string,
): Promise<DeadlineVerification> {
  // ── Step 1: Load from DB ──────────────────────────────────────────────────
  let row: (typeof callKnowledge.$inferSelect) | undefined
  try {
    const rows = await db
      .select()
      .from(callKnowledge)
      .where(eq(callKnowledge.callId, callId))
      .limit(1)
    row = rows[0]
  } catch (err) {
    log.error(
      { userId: ctx.userId, callId, error: err instanceof Error ? err.message : String(err) },
      'verifyDeadline: DB lookup failed',
    )
    throw new ExternalDependencyError(
      'Database',
      err instanceof Error ? err.message : 'Database lookup failed',
    )
  }

  if (!row) {
    throw new NotFoundError('callKnowledge', callId)
  }

  // ── Step 2: Extract deadline from normalized blueprint ────────────────────
  const normalized = (row.normalized ?? {}) as Record<string, unknown>
  const deadline =
    (normalized.deadline as string | undefined) ??
    (normalized.submissionDeadline as string | undefined) ??
    (normalized.callDeadline as string | undefined) ??
    null

  // ── Step 3: Calculate open/closed status ─────────────────────────────────
  const warnings: string[] = []
  let isOpen = true

  if (deadline) {
    const deadlineDate = new Date(deadline)
    if (isNaN(deadlineDate.getTime())) {
      warnings.push(`Deadline value "${deadline}" could not be parsed as a date`)
    } else {
      const diffMs = deadlineDate.getTime() - ctx.now.getTime()
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      isOpen = daysRemaining > 0

      if (!isOpen) {
        warnings.push(`Deadline passed ${Math.abs(daysRemaining)} day(s) ago`)
      } else if (daysRemaining <= 14) {
        warnings.push(`Closing soon: ${daysRemaining} day(s) remaining`)
      }
    }
  } else {
    warnings.push('No deadline found in cached blueprint — freshness check recommended')
  }

  const verifiedAt = ctx.now.toISOString()

  log.info(
    { userId: ctx.userId, callId, deadline, isOpen, verifiedAt },
    'verifyDeadline: complete',
  )

  return {
    callId,
    isOpen,
    currentDeadline: deadline,
    warnings,
    verifiedAt,
  }
}

// ── checkCallPageUpdates ───────────────────────────────────────────────────

/**
 * Compares the provided cachedBlueprintHash against the SHA-256 of the
 * currently stored blueprint in callKnowledge.normalized.
 *
 * Returns CallPageDiff with:
 *   - hasChanged: true when currentHash != cachedBlueprintHash
 *   - diffSummary: short human-readable description of what changed
 *   - currentHash: SHA-256 of the current stored blueprint JSON
 *   - previousHash: the provided cachedBlueprintHash (treated as the old value)
 *
 * Throws NotFoundError if callId is not in callKnowledge.
 */
export async function checkCallPageUpdates(
  ctx: ServiceContext,
  callId: string,
  cachedBlueprintHash: string,
): Promise<CallPageDiff> {
  // ── Step 1: Load from DB ──────────────────────────────────────────────────
  let row: (typeof callKnowledge.$inferSelect) | undefined
  try {
    const rows = await db
      .select()
      .from(callKnowledge)
      .where(eq(callKnowledge.callId, callId))
      .limit(1)
    row = rows[0]
  } catch (err) {
    log.error(
      { userId: ctx.userId, callId, error: err instanceof Error ? err.message : String(err) },
      'checkCallPageUpdates: DB lookup failed',
    )
    throw new ExternalDependencyError(
      'Database',
      err instanceof Error ? err.message : 'Database lookup failed',
    )
  }

  if (!row) {
    throw new NotFoundError('callKnowledge', callId)
  }

  // ── Step 2: Hash the stored blueprint ────────────────────────────────────
  const currentHash = createHash('sha256')
    .update(JSON.stringify(row.normalized ?? {}))
    .digest('hex')

  const hasChanged = currentHash !== cachedBlueprintHash

  // Derive a human-readable source URL from sourceDocs if available
  const sourceDocs = (row.sourceDocs as string[]) ?? []
  const sourceUrl = sourceDocs[0] ?? `callKnowledge:${callId}`

  const diffSummary: string | null = hasChanged
    ? `Blueprint content has changed since hash ${cachedBlueprintHash.slice(0, 8)}…`
    : null

  log.info(
    { userId: ctx.userId, callId, hasChanged, currentHash: currentHash.slice(0, 8) },
    'checkCallPageUpdates: comparison complete',
  )

  return {
    callId,
    sourceUrl,
    previousHash: cachedBlueprintHash,
    currentHash,
    hasChanged,
    diffSummary,
    checkedAt: ctx.now,
  }
}
