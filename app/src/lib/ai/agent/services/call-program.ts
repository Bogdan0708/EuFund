// ── Call → Program lookup ────────────────────────────────────────────────
// Returns the programCode payload value the agent should filter on when
// retrieving evidence for a call. Resolves the call's parent program code
// through calls_for_proposals → funding_programs.
//
// The helper accepts any identifier the agent might persist as a call's
// "id", because the discovery fallback chain in searchCalls (evidence.ts)
// emits call IDs as `call_id || callId || call_code || callCode || sourceId
// || r.id` and preselect persists that result verbatim as the session's
// selectedCallId. So `callId` here can be:
//
//   • a UUID — calls_for_proposals.id (the canonical case)
//   • a call_code like "PDD/216" — bulk-ingested points often only carry this
//   • a sha256-shaped sourceId — content hash, won't resolve to a call
//   • a Qdrant point UUID — same UUID shape as 1, but not a call PK
//
// Lookup order is shape-driven: UUID → id, otherwise call_code, then a
// last-chance external_id probe with ambiguity safety (LIMIT 2 +
// `length === 1`) because external_id is composite-unique on
// (source_connector_id, external_id) and the same value can repeat across
// connectors. Returns null on miss, DB error, or external_id ambiguity —
// callers fall back to unfiltered vector search rather than break.

import { db } from '@/lib/db'
import { callsForProposals, fundingPrograms } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'service-call-program' })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuidShape(s: string): boolean {
  return UUID_RE.test(s)
}

/**
 * Returns the funding_programs.code for the given call's parent program, or
 * null if the identifier doesn't resolve. Never throws — failure resolves
 * to null so callers can fall back to an unfiltered vector search instead
 * of breaking evidence retrieval.
 */
export async function lookupCallProgramCode(callId: string): Promise<string | null> {
  try {
    // 1. UUID-shaped → try calls_for_proposals.id first. Skip on miss; a
    //    UUID-shaped string that doesn't resolve here is most likely a
    //    Qdrant point UUID, which won't match call_code either (call codes
    //    look like "PDD/216", never UUID-shaped).
    if (isUuidShape(callId)) {
      const byId = await db
        .select({ code: fundingPrograms.code })
        .from(callsForProposals)
        .innerJoin(fundingPrograms, eq(fundingPrograms.id, callsForProposals.programId))
        .where(eq(callsForProposals.id, callId))
        .limit(1)
      if (byId[0]) return byId[0].code
      return null
    }

    // 2. Non-UUID → try call_code (UNIQUE index, single match guaranteed).
    const byCode = await db
      .select({ code: fundingPrograms.code })
      .from(callsForProposals)
      .innerJoin(fundingPrograms, eq(fundingPrograms.id, callsForProposals.programId))
      .where(eq(callsForProposals.callCode, callId))
      .limit(1)
    if (byCode[0]) return byCode[0].code

    // 3. Last chance: external_id. Composite-unique on (source_connector_id,
    //    external_id) — the same external_id CAN repeat across connectors,
    //    so probe with LIMIT 2 and only resolve when exactly one row matches.
    //    External IDs are all null in production today; this branch exists
    //    for forward compatibility with connector-seeded calls.
    const byExt = await db
      .select({ code: fundingPrograms.code })
      .from(callsForProposals)
      .innerJoin(fundingPrograms, eq(fundingPrograms.id, callsForProposals.programId))
      .where(eq(callsForProposals.externalId, callId))
      .limit(2)
    if (byExt.length === 1) return byExt[0].code

    return null
  } catch (err) {
    log.warn(
      { callId, error: err instanceof Error ? err.message : String(err) },
      'lookupCallProgramCode failed — caller will fall back to unfiltered search',
    )
    return null
  }
}
