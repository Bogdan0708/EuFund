// ── Blueprint Service ──────────────────────────────────────────────────────
// Three responsibilities:
//   1. Lookup cached blueprint — check callKnowledge, return if confidence >= 0.4
//   2. Assemble extraction input — on cache miss, gather Qdrant evidence
//   3. Persist blueprint — save agent-extracted structure with provenance
//
// Cache-miss is a valid domain outcome. lookupBlueprint ALWAYS returns
// success: true. The `cached` field tells callers which branch to take.
//
// Layer rule: do NOT import from ../tools/ or ../mcp/.

import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getVectorStore } from '@/lib/vectors/store'
import { logger } from '@/lib/logger'
import { ExternalDependencyError } from './errors'
import { lookupCallProgramCode } from './call-program'
import type { ServiceContext } from './types'
import type { CallBlueprint, SectionSpec } from '@/lib/ai/agent/types'
import type { BlueprintLookupResult, BlueprintSaveResult, EvidenceChunk } from './types'

const log = logger.child({ component: 'service-blueprint' })

// Document type priority for ranking evidence chunks (same as evidence.ts)
const DOC_TYPE_PRIORITY: Record<string, number> = {
  ghid: 1,
  anexa: 2,
  cerere: 3,
  legislation: 4,
  summary: 5,
}

// ── lookupBlueprint ────────────────────────────────────────────────────────

/**
 * Returns a cached blueprint when confidence >= 0.4, otherwise retrieves raw
 * evidence chunks from Qdrant for the agent to extract from.
 *
 * Always resolves (never rejects). Cache miss is `{ cached: false, ... }`.
 */
export async function lookupBlueprint(
  ctx: ServiceContext,
  callId: string,
): Promise<BlueprintLookupResult> {
  // ── Step 1: Check cache ──────────────────────────────────────────────────
  let cached: (typeof callKnowledge.$inferSelect) | undefined
  try {
    const rows = await db
      .select()
      .from(callKnowledge)
      .where(eq(callKnowledge.callId, callId))
      .limit(1)
    cached = rows[0]
  } catch (err) {
    log.warn(
      { userId: ctx.userId, sessionId: ctx.sessionId, callId, error: err instanceof Error ? err.message : String(err) },
      'lookupBlueprint DB cache check failed — proceeding to Qdrant',
    )
  }

  if (cached && cached.structureConfidence >= 0.4) {
    const norm = (cached.normalized ?? {}) as Record<string, unknown>
    const blueprint = buildBlueprintFromCache(cached, norm)

    log.info(
      { userId: ctx.userId, callId, source: 'cache', confidence: cached.structureConfidence },
      'lookupBlueprint: cache hit',
    )

    return { cached: true, blueprint, rawEvidence: null }
  }

  // ── Step 2: Cache miss — retrieve raw evidence from Qdrant ───────────────
  log.info(
    { userId: ctx.userId, sessionId: ctx.sessionId, callId },
    'lookupBlueprint: cache miss, retrieving evidence',
  )

  let store: ReturnType<typeof getVectorStore>
  try {
    store = getVectorStore()
  } catch (err) {
    throw new ExternalDependencyError(
      'VectorStore',
      err instanceof Error ? err.message : 'Failed to initialise vector store',
    )
  }

  // Filter on the call's parent programCode (same rationale as
  // retrieveEvidence in evidence.ts): the historical `{ callId }` filter
  // matched zero Qdrant points in production and degraded to unfiltered
  // search via the fallback. Filtering by programCode actually narrows.
  const programCode = await lookupCallProgramCode(callId)

  let results: Awaited<ReturnType<typeof store.search>>
  try {
    const filter = programCode ? { programCode } : undefined
    results = await store.search(callId, 20, filter)
    if (results.length === 0 && filter) {
      results = await store.search(callId, 20)
    }
  } catch (err) {
    log.error(
      { userId: ctx.userId, sessionId: ctx.sessionId, callId, error: err instanceof Error ? err.message : String(err) },
      'lookupBlueprint vector store search failed',
    )
    throw new ExternalDependencyError(
      'VectorStore',
      err instanceof Error ? err.message : 'Vector store search failed',
    )
  }

  const rawEvidence: EvidenceChunk[] = results.map(r => {
    const docType =
      (r.metadata.documentType as string) ||
      (r.metadata.docType as string) ||
      'unknown'
    return {
      id: r.id,
      content: r.content,
      docType,
      source:
        (r.metadata.source as string) ||
        (r.metadata.sourceUrl as string) ||
        'unknown',
      score: r.score,
      priority: DOC_TYPE_PRIORITY[docType] ?? 10,
    }
  })

  // Sort by priority (lower = better), then by score descending
  rawEvidence.sort((a, b) => a.priority - b.priority || b.score - a.score)

  log.info(
    { userId: ctx.userId, sessionId: ctx.sessionId, callId, chunks: rawEvidence.length },
    'lookupBlueprint: evidence retrieved',
  )

  return { cached: false, blueprint: null, rawEvidence }
}

// ── saveCallBlueprint ──────────────────────────────────────────────────────

/**
 * Upserts an agent-extracted blueprint into callKnowledge.
 * Computes a SHA-256 content hash of the normalized data for provenance.
 */
export async function saveCallBlueprint(
  ctx: ServiceContext,
  callId: string,
  blueprint: CallBlueprint,
): Promise<BlueprintSaveResult> {
  const sections = blueprint.normalized?.requiredSections ?? blueprint.requiredSections ?? []
  const normalizedPayload = { requiredSections: sections }
  const contentHash = createHash('sha256')
    .update(JSON.stringify(normalizedPayload))
    .digest('hex')

  try {
    await db
      .insert(callKnowledge)
      .values({
        callId,
        program: blueprint.program || 'Unknown',
        callTitle: callId,
        normalized: normalizedPayload,
        status: 'provisional',
        extractedFrom: 'qdrant_obsidian',
        structureConfidence: blueprint.structureConfidence ?? 0.3,
        sourceDocs: blueprint.sources ?? [],
      })
      .onConflictDoUpdate({
        target: callKnowledge.callId,
        set: {
          normalized: normalizedPayload,
          structureConfidence: blueprint.structureConfidence ?? 0.3,
          sourceDocs: blueprint.sources ?? [],
          contentExtractedAt: new Date(),
          updatedAt: new Date(),
        },
      })
  } catch (err) {
    log.warn(
      { userId: ctx.userId, sessionId: ctx.sessionId, callId, error: err instanceof Error ? err.message : String(err) },
      'saveCallBlueprint DB upsert failed',
    )
    throw new ExternalDependencyError(
      'Database',
      err instanceof Error ? err.message : 'Failed to persist blueprint',
      false,
    )
  }

  log.info(
    { userId: ctx.userId, sessionId: ctx.sessionId, callId, contentHash },
    'saveCallBlueprint: blueprint persisted',
  )

  return {
    callId,
    version: 1,
    contentHash,
    persistedAt: ctx.now,
  }
}

// ── buildBlueprintFromCache ────────────────────────────────────────────────
// Internal helper — moved here from tools/resolve-call.ts.

/**
 * Cache rows store the minimal section shape `{ title, description,
 * evaluationWeight? }` — that's all save_call_blueprint and the migration
 * 0008 path persist. But the V3 runtime treats `normalized.requiredSections`
 * as full `SectionSpec[]`, and downstream tools (notably `generate_section`,
 * which dereferences `section.id`) crash on the partial shape. Materialize
 * the missing fields here so the blueprint that leaves the cache is
 * always SectionSpec-shaped end-to-end.
 *
 * Slug derivation matches what `extract_structure` produces so an outline
 * generated by either path renders identically in the UI.
 */
// Matches the agent_sections.sectionKey varchar(100) cap (schema.ts:931).
// Long titles ("Plan de implementare detaliat pe etape — anul 1, anul 2, anul 3...")
// would otherwise slug to a >100-char key, fail INSERT, and bubble a 500 to the
// user. Truncate eagerly, then strip a trailing hyphen left by truncation.
const SECTION_KEY_MAX = 100

function slugifyTitle(title: string, fallbackIdx: number): string {
  const raw = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const slug = raw.length > SECTION_KEY_MAX
    ? raw.slice(0, SECTION_KEY_MAX).replace(/-+$/, '')
    : raw
  return slug || `section-${fallbackIdx + 1}`
}

/**
 * Cached `requiredSections` can come from two writers:
 *   - save_call_blueprint / migration 0008 path: only persists the partial
 *     shape `{ title, description, evaluationWeight? }`, lossy on purpose.
 *   - resolve_call LLM-extraction path (tools/resolve-call.ts:122): writes
 *     the full SectionSpec for the LLM-derived outline.
 *
 * We can't know which producer wrote a given row, so detect the shape on
 * read. Rows that already carry id+order are passed through (preserves
 * dependsOn, importance, mandatory, etc.); rows missing those fields are
 * synthesized with sensible defaults so the downstream contract holds.
 */
function isFullSectionSpec(s: unknown): s is SectionSpec {
  if (!s || typeof s !== 'object') return false
  const r = s as Record<string, unknown>
  return typeof r.id === 'string' && r.id.length > 0 && typeof r.order === 'number'
}

export function materializeCachedSections(
  cached: unknown[],
  structureConfidence: number,
): SectionSpec[] {
  return cached.map((entry, i): SectionSpec => {
    if (isFullSectionSpec(entry)) return entry
    const partial = (entry ?? {}) as { title?: string; description?: string; evaluationWeight?: number }
    const title = partial.title ?? `Section ${i + 1}`
    const description = partial.description ?? ''
    return {
      id: slugifyTitle(title, i),
      title,
      description,
      order: i + 1,
      generationOrder: i + 1,
      importance: 'standard',
      expectedLength: 'medium',
      dependsOn: [],
      modelHint: partial.evaluationWeight && partial.evaluationWeight > 0 ? 'heavy' : 'light',
      evaluationWeight: partial.evaluationWeight,
      mandatory: true,
      confidence: structureConfidence,
    }
  })
}

/**
 * Project a full CallBlueprint into the SectionSpec[] shape used for
 * agent_sessions.outline. Idempotent on already-full SectionSpec rows;
 * materializes partial cached rows via materializeCachedSections so
 * downstream code can always assume the 12-field SectionSpec contract.
 */
export function outlineFromBlueprint(blueprint: CallBlueprint): SectionSpec[] {
  return materializeCachedSections(
    blueprint.normalized.requiredSections,
    blueprint.structureConfidence,
  )
}

export function buildBlueprintFromCache(
  row: typeof callKnowledge.$inferSelect,
  norm: Record<string, unknown>,
): CallBlueprint {
  const cachedSections = (norm.requiredSections ?? []) as unknown[]
  const mandatoryAnnexes = (norm.mandatoryAnnexes ?? []) as string[]
  const eligibilityCriteria = (norm.eligibilityCriteria ?? []) as string[]
  const evaluationGrid = (norm.evaluationGrid ?? []) as { criterion: string; maxPoints: number }[]
  const cofinancingRate = (norm.cofinancingRate ?? 0) as number

  const materialized = materializeCachedSections(cachedSections, row.structureConfidence)

  // CallBlueprint.requiredSections (the lossy storage shape) is rebuilt from
  // the materialized data so it's always populated even if the partial
  // writer left fields off — keeps anything that snoops the top-level
  // field consistent with `.normalized.requiredSections`.
  const lossyRequiredSections = materialized.map(s => ({
    title: s.title,
    description: s.description,
    evaluationWeight: s.evaluationWeight,
  }))

  return {
    callId: row.callId,
    program: row.program,
    isOpen: true,
    amendments: [],
    warnings: [],
    requiredSections: lossyRequiredSections,
    mandatoryAnnexes,
    eligibilityCriteria,
    evaluationGrid,
    cofinancingRate,
    eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
    sources: (row.sourceDocs as string[]) || [],
    verifiedAt: row.contentExtractedAt.toISOString(),
    raw: { notebookLmResponse: '[cached]', perplexityResponse: '', retrievedAt: row.contentExtractedAt.toISOString() },
    normalized: {
      requiredSections: materialized,
      mandatoryAnnexes,
      eligibilityCriteria,
      evaluationGrid,
      cofinancingRate,
    },
    structureConfidence: row.structureConfidence,
  }
}

// ── buildCallBlueprintFromArgs ───────────────────────────────────────────
//
// Converts the partial input shape that save_call_blueprint accepts into a
// full normalized CallBlueprint. Used by:
//   - The MCP handler (mcp/write/save-call-blueprint.ts) for the call to
//     saveCallBlueprint().
//   - The managed executor's save_call_blueprint case for both
//     saveCallBlueprint() AND the agent_sessions.blueprint write-back.
//
// Both call sites MUST construct the blueprint via this helper; otherwise
// the cache row and the session row drift, and the next-turn skip
// condition (`!session.blueprint`) becomes unreliable.

export interface SaveCallBlueprintArgs {
  callId: string
  blueprint: {
    callId?: string
    program?: string
    requiredSections?: { title: string; description: string; evaluationWeight?: number }[]
    mandatoryAnnexes?: string[]
    eligibilityCriteria?: string[]
    structureConfidence?: number
    sources?: string[]
  }
}

export function buildCallBlueprintFromArgs(
  args: SaveCallBlueprintArgs,
  ctx: ServiceContext,
): CallBlueprint {
  const requiredSections = args.blueprint.requiredSections ?? []
  const mandatoryAnnexes = args.blueprint.mandatoryAnnexes ?? []
  const eligibilityCriteria = args.blueprint.eligibilityCriteria ?? []
  const sources = args.blueprint.sources ?? []
  const verifiedAt = ctx.now.toISOString()

  // The schema input only carries { title, description, evaluationWeight? }
  // per section. CallBlueprint.normalized.requiredSections is SectionSpec[]
  // which has additional fields. The cache row in callKnowledge has
  // historically stored the partial shape via the `as SectionSpec[]`
  // precedent in buildBlueprintFromCache. Match that precedent here at
  // the boundary so the helper's return type is honored without an `any`
  // cast on the whole shape.
  return {
    callId: args.callId,
    program: args.blueprint.program ?? 'Unknown',
    isOpen: true,
    amendments: [],
    warnings: [],
    requiredSections,
    mandatoryAnnexes,
    eligibilityCriteria,
    evaluationGrid: [],
    cofinancingRate: 0,
    eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
    sources,
    verifiedAt,
    raw: { notebookLmResponse: '', perplexityResponse: '', retrievedAt: verifiedAt },
    normalized: {
      requiredSections: requiredSections as unknown as SectionSpec[],
      mandatoryAnnexes,
      eligibilityCriteria,
      evaluationGrid: [],
      cofinancingRate: 0,
    },
    structureConfidence: args.blueprint.structureConfidence ?? 0.3,
  }
}
