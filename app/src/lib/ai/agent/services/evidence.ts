// ── Evidence Service ──────────────────────────────────────────────────────
// Extracted business logic for call searching and evidence retrieval.
// Framework-agnostic: no ToolResult, no StateTransitions.

import { getVectorStore } from '@/lib/vectors/store'
import { logger } from '@/lib/logger'
import { ExternalDependencyError } from './errors'
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

export interface SearchCallsOptions {
  program?: string
  maxResults?: number
}

export async function searchCalls(
  ctx: ServiceContext,
  query: string,
  opts: SearchCallsOptions = {},
): Promise<{ matches: CallMatch[] }> {
  const maxResults = opts.maxResults ?? 5

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
    filter.program = opts.program
  }

  let results
  try {
    results = await store.search(
      query,
      maxResults * 2,
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

  // Deduplicate by callId (multiple chunks from the same call)
  const seen = new Set<string>()
  const matches: CallMatch[] = []
  for (const r of results) {
    const callId =
      (r.metadata.callId as string) ||
      (r.metadata.sourceId as string) ||
      r.id
    if (seen.has(callId)) continue
    seen.add(callId)
    matches.push({
      callId,
      title:
        (r.metadata.callTitle as string) ||
        (r.metadata.title as string) ||
        callId,
      program: (r.metadata.program as string) || 'unknown',
      score: Math.round(r.score * 100) / 100,
      snippet: r.content.slice(0, 200),
      sourceUrl: r.metadata.sourceUrl as string | undefined,
    })
    if (matches.length >= maxResults) break
  }

  log.info(
    { userId: ctx.userId, sessionId: ctx.sessionId, query, results: matches.length },
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

  let results
  try {
    results = await store.search(searchQuery, maxChunks * 2, { callId })

    // If filtered search returns nothing, try broader search
    if (results.length === 0) {
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
