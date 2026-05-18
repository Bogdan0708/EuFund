// ── Evidence Service ──────────────────────────────────────────────────────
// Extracted business logic for call searching and evidence retrieval.
// Framework-agnostic: no ToolResult, no StateTransitions.

import { getVectorStore } from '@/lib/vectors/store'
import { logger } from '@/lib/logger'
import { ExternalDependencyError } from './errors'
import { lookupCallProgramCode } from './call-program'
import type { ServiceContext } from './types'
import type { CallMatch, EvidenceBundle, EvidenceChunk } from './types'

const log = logger.child({ component: 'service-evidence' })

// Document type priority for ranking evidence chunks
const DOC_TYPE_PRIORITY: Record<string, number> = {
  ghid: 1,
  anexa: 2,
  cerere: 3,
  legislation: 4,
  summary: 5,
}

// ── searchCalls ────────────────────────────────────────────────────────────

// Default per-program cap. With POTJ holding ~4,800 chunks (17% of corpus)
// vs PNRR at 303 (1%), unbounded top-K would let POTJ-doc rows fill every
// slot — observed in prod 2026-05-14. Capping at 2 leaves the highest two
// POTJ matches in but reserves the remaining slots for other programs so
// the model (and the preselect ambiguity check) sees real diversity.
const DEFAULT_PER_PROGRAM_CAP = 2

// Programs whose chunks lack actionable metadata (UNKNOWN classification
// from bulk-ingest). Dropping these by default removes ~24% of the corpus
// from results — chunks the agent cannot reason about (no program means no
// eligibility, no blueprint, no call). If a query has NO non-UNKNOWN
// matches we fall back to including them so the user isn't left with zero
// results. Explicit opt-in (`includeUnknownProgram: true`) bypasses the
// drop — used by tooling that just needs raw text similarity.
const UNKNOWN_PROGRAM_CODES = new Set(['unknown', 'UNKNOWN'])

export interface SearchCallsOptions {
  /**
   * Filter by program code. Public API stays on `program` for backward
   * compat with the MCP tool surface, but the underlying Qdrant payload
   * field is `programCode` (set by bulk-ingest-rag-knowledge.ts). The
   * filter is translated below — passing the old `program` payload key
   * would silently match nothing.
   */
  program?: string
  maxResults?: number
  /**
   * Maximum chunks per program in the result set. Default 2 — keeps the
   * top two by score per program so POTJ (or any over-represented program)
   * doesn't crowd the top-K. Set higher when filtering to a single program
   * via `opts.program` (the cap then has no effect anyway).
   */
  maxResultsPerProgram?: number
  /**
   * When true, include results whose program is UNKNOWN. Default false —
   * UNKNOWN chunks are not actionable for call selection. Even with this
   * flag false the function still falls back to including UNKNOWN if no
   * other matches surface, so empty-result queries don't silently 0-out.
   */
  includeUnknownProgram?: boolean
  /**
   * Authoritative callId filter. When set, Qdrant returns only points whose
   * metadata.callId matches exactly — the query string is still embedded,
   * but the filter is the discriminator. Used by the preselect confirm-mode
   * existence probe. `matches.length === 0` means no point carries that
   * metadata.callId (the call may still exist via metadata.sourceId or
   * point id — see `sourceId` and the ultra-fallback in the route).
   */
  callId?: string
  /**
   * Authoritative sourceId filter. Same semantics as callId, but matches on
   * metadata.sourceId instead. Used as the second prong of the confirm-mode
   * existence probe, since `searchCalls` emits callId via the fallback chain
   * `metadata.callId || metadata.sourceId || r.id`.
   */
  sourceId?: string
  /**
   * Authoritative callCode filter. Same semantics as callId/sourceId, but
   * matches on metadata.callCode. Bulk-ingested points often carry callCode
   * as the primary identifier; the dedup loop above emits it as the second
   * prong of the fallback chain, so the confirm-mode existence probe must
   * be able to filter on it.
   */
  callCode?: string
}

export async function searchCalls(
  ctx: ServiceContext,
  query: string,
  opts: SearchCallsOptions = {},
): Promise<{ matches: CallMatch[] }> {
  const maxResults = opts.maxResults ?? 5
  // The per-program cap is a *diversity* mechanism. When the caller has
  // already narrowed the search to one program (or to a specific call via
  // callId/callCode/sourceId), there is no diversity to enforce — every
  // result will be in the same bucket, and capping at 2 silently truncates
  // any `maxResults > 2` request. The MCP tool surface exposes `program`
  // and `maxResults` but not `maxResultsPerProgram`, so without this
  // exemption an LLM calling search_calls({program:'POTJ', maxResults:5})
  // would receive at most 2 matches with no way to override. Codex flagged
  // this on PR #107 (2026-05-15).
  const narrowingFilterActive = Boolean(
    opts.program || opts.callId || opts.callCode || opts.sourceId,
  )
  const perProgramCap = opts.maxResultsPerProgram ?? (
    narrowingFilterActive ? Infinity : DEFAULT_PER_PROGRAM_CAP
  )
  const includeUnknown = opts.includeUnknownProgram ?? false

  let store: ReturnType<typeof getVectorStore>
  try {
    store = getVectorStore()
  } catch (err) {
    throw new ExternalDependencyError(
      'VectorStore',
      err instanceof Error ? err.message : 'Failed to initialise vector store',
    )
  }

  const filter: Record<string, unknown> = {}
  if (opts.program) {
    // The Qdrant payload key is programCode (bulk-ingest writes it at
    // bulk-ingest-rag-knowledge.ts:360). Translating from the public
    // `program` option preserves the API while making the filter actually
    // match — pre-fix, this filter was a no-op against every bulk-ingested
    // point and silently returned the wrong slice.
    filter.programCode = opts.program
  }
  if (opts.callId) {
    filter.call_id = opts.callId
  }
  if (opts.sourceId) {
    filter.sourceId = opts.sourceId
  }
  if (opts.callCode) {
    filter.call_code = opts.callCode
  }

  // Overfetch: 4× maxResults so the UNKNOWN drop + per-program cap still
  // leaves enough raw chunks to reach maxResults distinct calls. Previously
  // 2× was tight; with the new filters the dedup loop can starve.
  const fetchMultiplier = 4
  let results
  try {
    results = await store.search(
      query,
      maxResults * fetchMultiplier,
      Object.keys(filter).length > 0 ? filter : undefined,
    )
  } catch (err) {
    log.error(
      { userId: ctx.userId, sessionId: ctx.sessionId, query, error: err instanceof Error ? err.message : String(err) },
      'searchCalls vector store search failed',
    )
    throw new ExternalDependencyError(
      'VectorStore',
      err instanceof Error ? err.message : 'Vector store search failed',
    )
  }

  // Two-pass dedup:
  //   pass 1 — collect (callId-deduped) matches, splitting UNKNOWN aside.
  //   pass 2 — fill final list, enforcing per-program cap, with UNKNOWN
  //            fallback if pass 1's non-unknown pool is empty.
  const seen = new Set<string>()
  const programCounts = new Map<string, number>()
  const matches: CallMatch[] = []
  const unknownMatches: CallMatch[] = []
  for (const r of results) {
    const callId =
      (r.metadata.call_id as string) ||
      (r.metadata.callId as string) ||
      (r.metadata.call_code as string) ||
      (r.metadata.callCode as string) ||
      (r.metadata.sourceId as string) ||
      r.id
    if (seen.has(callId)) continue
    seen.add(callId)
    // Prefer programCode (the actual bulk-ingest payload key); fall back to
    // `program` for any legacy points that may still carry the old shape,
    // or test fixtures. Pre-fix this read the dead `program` field so every
    // bulk-ingested match surfaced as 'unknown' in the UI.
    const programRaw =
      (r.metadata.programCode as string) ||
      (r.metadata.program as string) ||
      'unknown'
    const match: CallMatch = {
      callId,
      title:
        (r.metadata.callTitle as string) ||
        (r.metadata.title as string) ||
        (r.metadata.titleRo as string) ||
        (r.metadata.titleEn as string) ||
        callId,
      program: programRaw,
      score: Math.round(r.score * 100) / 100,
      snippet: r.content.slice(0, 200),
      sourceUrl: r.metadata.sourceUrl as string | undefined,
    }

    if (UNKNOWN_PROGRAM_CODES.has(programRaw)) {
      unknownMatches.push(match)
      continue
    }

    const count = programCounts.get(programRaw) ?? 0
    if (count >= perProgramCap) continue
    programCounts.set(programRaw, count + 1)

    matches.push(match)
    if (matches.length >= maxResults) break
  }

  // UNKNOWN fallback: include them when either explicitly opted in or when
  // no non-unknown results came back at all. The latter case is critical —
  // a query that only matches UNKNOWN chunks (early-stage discovery against
  // unclassified corpus) must not return zero just because of the filter.
  if (includeUnknown || matches.length === 0) {
    for (const m of unknownMatches) {
      if (matches.length >= maxResults) break
      matches.push(m)
    }
  }

  log.info(
    {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      query,
      results: matches.length,
      droppedUnknown: includeUnknown ? 0 : Math.max(0, unknownMatches.length - (matches.length === 0 ? unknownMatches.length : 0)),
    },
    'searchCalls completed',
  )

  return { matches }
}

// ── retrieveEvidence ───────────────────────────────────────────────────────

export interface RetrieveEvidenceOptions {
  query?: string
  maxChunks?: number
}

export async function retrieveEvidence(
  ctx: ServiceContext,
  callId: string,
  opts: RetrieveEvidenceOptions = {},
): Promise<EvidenceBundle> {
  const maxChunks = opts.maxChunks ?? 15

  let store: ReturnType<typeof getVectorStore>
  try {
    store = getVectorStore()
  } catch (err) {
    throw new ExternalDependencyError(
      'VectorStore',
      err instanceof Error ? err.message : 'Failed to initialise vector store',
    )
  }

  const searchQuery = opts.query ? `${callId} ${opts.query}` : callId

  // Filter on the call's parent programCode — that's what bulk-ingest writes
  // into Qdrant payloads. The historical `{ callId }` filter never matched a
  // single point in production (no point carries `callId` in payload), so the
  // function depended entirely on the unfiltered fallback. Filtering by
  // programCode restores intentional narrowing for the ~76% of points that
  // do carry an ingested programCode.
  const programCode = await lookupCallProgramCode(callId)

  let results
  try {
    const filter = programCode ? { programCode } : undefined
    results = await store.search(searchQuery, maxChunks * 2, filter)

    // If filtered search returns nothing, try broader search. Keeps callers
    // resilient when programCode lookup failed (returned null), the call's
    // program has no indexed points, or filter+query intersection is empty.
    if (results.length === 0 && filter) {
      results = await store.search(searchQuery, maxChunks * 2)
    }
  } catch (err) {
    log.error(
      { userId: ctx.userId, sessionId: ctx.sessionId, callId, error: err instanceof Error ? err.message : String(err) },
      'retrieveEvidence vector store search failed',
    )
    throw new ExternalDependencyError(
      'VectorStore',
      err instanceof Error ? err.message : 'Vector store search failed',
    )
  }

  // Map and rank by document type
  const chunks: EvidenceChunk[] = results.map(r => {
    const docType =
      (r.metadata.documentType as string) ||
      (r.metadata.docType as string) ||
      'unknown'
    return {
      id: r.id,
      content: r.content,
      docType,
      source: (r.metadata.source as string) || (r.metadata.sourceUrl as string) || 'unknown',
      score: r.score,
      priority: DOC_TYPE_PRIORITY[docType] ?? 10,
    }
  })

  // Sort by priority (lower = better), then by score descending
  chunks.sort((a, b) => a.priority - b.priority || b.score - a.score)

  const trimmed = chunks.slice(0, maxChunks)

  log.info(
    { userId: ctx.userId, sessionId: ctx.sessionId, callId, totalChunks: results.length, returned: trimmed.length },
    'retrieveEvidence completed',
  )

  return {
    callId,
    chunks: trimmed,
    totalChunks: results.length,
    retrievedAt: ctx.now,
  }
}
