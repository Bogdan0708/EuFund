import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSearch = vi.fn()
// vi.mock factories are hoisted to the top of the file — referencing a
// `const` declared below would fail with a temporal-dead-zone error. The
// existing `mockSearch` pattern works because the factory returns a function
// that closes over it (deferred read). For lookupCallProgramCode we'd be
// assigning the variable directly into the exported shape, so use vi.hoisted
// to lift the initialization above the mock factory.
const { mockLookupCallProgramCode } = vi.hoisted(() => ({
  mockLookupCallProgramCode: vi.fn(),
}))

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(() => ({ search: mockSearch })),
}))

vi.mock('@/lib/ai/agent/services/call-program', () => ({
  lookupCallProgramCode: mockLookupCallProgramCode,
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

// Import AFTER mocks
import { searchCalls, retrieveEvidence } from '@/lib/ai/agent/services/evidence'
import { ExternalDependencyError } from '@/lib/ai/agent/services/errors'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Fixtures ───────────────────────────────────────────────────────────────

const baseCtx: ServiceContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  requestId: 'req-test-001',
  now: new Date('2026-04-09T10:00:00Z'),
}

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chunk-default',
    content: 'Default content for the call',
    score: 0.8,
    metadata: {
      callId: 'CALL-001',
      callTitle: 'Default Call',
      program: 'PNRR',
      sourceUrl: 'https://example.com/call',
      ...overrides,
    },
  }
}

// ── searchCalls tests ──────────────────────────────────────────────────────

describe('searchCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates results by callId', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'PNRR Component 11 - Green energy transition call',
        score: 0.92,
        metadata: { callId: 'PNRR-C11-001', callTitle: 'Green Energy Transition', program: 'PNRR' },
      },
      {
        id: 'chunk-2',
        content: 'PNRR Component 11 - additional details',
        score: 0.88,
        metadata: { callId: 'PNRR-C11-001', callTitle: 'Green Energy Transition', program: 'PNRR' },
      },
      {
        id: 'chunk-3',
        content: 'PEO digital transformation fund',
        score: 0.75,
        metadata: { callId: 'PEO-DIG-002', callTitle: 'Digital Transformation', program: 'PEO' },
      },
    ])

    const result = await searchCalls(baseCtx, 'green energy')

    expect(result.matches).toHaveLength(2)
    expect(result.matches[0].callId).toBe('PNRR-C11-001')
    expect(result.matches[1].callId).toBe('PEO-DIG-002')
  })

  it('respects maxResults limit', async () => {
    // Return 6 unique results across THREE programs (2 each) so the
    // per-program cap (default 2) doesn't gate the maxResults limit.
    const programs = ['PEO', 'PNRR', 'POCIDIF']
    const storeResults = Array.from({ length: 6 }, (_, i) => ({
      id: `chunk-${i}`,
      content: `Content for call ${i}`,
      score: 0.9 - i * 0.05,
      metadata: {
        callId: `CALL-00${i}`,
        callTitle: `Call ${i}`,
        programCode: programs[i % programs.length],
      },
    }))
    mockSearch.mockResolvedValue(storeResults)

    const result = await searchCalls(baseCtx, 'digital transformation', { maxResults: 3 })

    expect(result.matches).toHaveLength(3)
  })

  it('passes program filter to vector store using programCode key', async () => {
    // Public API stays `program` for callers; payload key is `programCode`
    // (what bulk-ingest writes). Pre-fix, the filter passed `program` and
    // matched nothing in the bulk-ingested corpus.
    mockSearch.mockResolvedValue([makeResult({ programCode: 'POTJ' })])

    await searchCalls(baseCtx, 'tourism', { program: 'POTJ' })

    const [, , filter] = mockSearch.mock.calls[0]
    expect(filter).toEqual({ programCode: 'POTJ' })
  })

  it('passes no filter when program is omitted', async () => {
    mockSearch.mockResolvedValue([makeResult()])

    await searchCalls(baseCtx, 'green energy')

    const [, , filter] = mockSearch.mock.calls[0]
    expect(filter).toBeUndefined()
  })

  it('prefers canonical call_id over legacy callId/callCode/sourceId when emitting match IDs', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Canonical payload point',
        score: 0.9,
        metadata: {
          call_id: '11111111-1111-4111-8111-111111111111',
          callId: 'legacy-call-id',
          call_code: 'PNRR/001',
          callCode: 'legacy-code',
          programCode: 'PNRR',
        },
      },
    ])

    const result = await searchCalls(baseCtx, 'canonical')

    expect(result.matches[0].callId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('passes callId and callCode filters using canonical Qdrant payload keys', async () => {
    mockSearch.mockResolvedValue([])

    await searchCalls(baseCtx, 'probe-id', { callId: 'uuid-1' })
    expect(mockSearch.mock.calls.at(-1)?.[2]).toEqual({ call_id: 'uuid-1' })

    await searchCalls(baseCtx, 'probe-code', { callCode: 'PNRR/001' })
    expect(mockSearch.mock.calls.at(-1)?.[2]).toEqual({ call_code: 'PNRR/001' })
  })

  it('truncates snippet to 200 chars', async () => {
    const longContent = 'A'.repeat(300)
    mockSearch.mockResolvedValue([{ ...makeResult(), content: longContent }])

    const result = await searchCalls(baseCtx, 'any')

    expect(result.matches[0].snippet).toHaveLength(200)
  })

  it('throws ExternalDependencyError on vector store failure', async () => {
    mockSearch.mockRejectedValue(new Error('Qdrant connection refused'))

    await expect(searchCalls(baseCtx, 'green energy')).rejects.toBeInstanceOf(ExternalDependencyError)
  })

  it('ExternalDependencyError has retryable=true by default', async () => {
    mockSearch.mockRejectedValue(new Error('timeout'))

    const err = await searchCalls(baseCtx, 'any').catch(e => e)

    expect(err).toBeInstanceOf(ExternalDependencyError)
    expect((err as ExternalDependencyError).retryable).toBe(true)
    expect((err as ExternalDependencyError).service).toBe('VectorStore')
  })

  it('falls back to chunk-id when callId metadata is absent', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'raw-chunk-xyz',
        content: 'Some content',
        score: 0.7,
        metadata: { program: 'PNRR' }, // no callId or sourceId
      },
    ])

    const result = await searchCalls(baseCtx, 'any')

    expect(result.matches[0].callId).toBe('raw-chunk-xyz')
  })

  // Regression: bulk-ingest-rag-knowledge.ts writes titleRo + callCode + sourceId
  // (contentHash) but NOT callTitle/title/callId. Prior to the fallback fix,
  // candidates surfaced the MD5 hash as both id and display title.
  it('uses titleRo when callTitle/title are absent', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'md5hash-abc123',
        content: 'Ghid solicitant PNRR Digital',
        score: 0.82,
        metadata: {
          sourceId: 'md5hash-abc123',
          callCode: 'PNRR/2024/C7/I8',
          titleRo: 'Digitalizarea IMM-urilor',
          program: 'PNRR',
        },
      },
    ])

    const result = await searchCalls(baseCtx, 'digital transformation')

    expect(result.matches[0].title).toBe('Digitalizarea IMM-urilor')
    expect(result.matches[0].callId).toBe('PNRR/2024/C7/I8')
  })

  it('falls through titleRo, titleEn, then callId for the display title', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'md5-1',
        content: 'content',
        score: 0.7,
        metadata: {
          sourceId: 'md5-1',
          callCode: 'PEO/2024/1.1',
          titleEn: 'SME Growth Scheme',
          program: 'PEO',
        },
      },
    ])

    const result = await searchCalls(baseCtx, 'any')

    expect(result.matches[0].title).toBe('SME Growth Scheme')
    expect(result.matches[0].callId).toBe('PEO/2024/1.1')
  })

  it('prefers callCode over sourceId for callId when metadata.callId is absent', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'point-id-zzz',
        content: 'content',
        score: 0.7,
        metadata: {
          sourceId: 'md5-hash-xyz',
          callCode: 'POTJ/2024/M1',
          program: 'POTJ',
        },
      },
    ])

    const result = await searchCalls(baseCtx, 'any')

    expect(result.matches[0].callId).toBe('POTJ/2024/M1')
  })

  it('returns score rounded to 2 decimal places', async () => {
    mockSearch.mockResolvedValue([{ ...makeResult(), score: 0.9166666 }])

    const result = await searchCalls(baseCtx, 'any')

    expect(result.matches[0].score).toBe(0.92)
  })

  // ── Regression: program field rename ────────────────────────────────────
  // bulk-ingest-rag-knowledge.ts writes programCode, but searchCalls used
  // to read metadata.program — so every bulk-ingested match surfaced as
  // program='unknown' in the UI. The read now prefers programCode and
  // falls back to program for legacy/test fixtures.

  it('reads programCode in preference to program metadata', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'POTJ Just Transition guide',
        score: 0.8,
        metadata: { callId: 'POTJ-001', programCode: 'POTJ' },
      },
    ])

    const result = await searchCalls(baseCtx, 'just transition')

    expect(result.matches[0].program).toBe('POTJ')
  })

  it('falls back to legacy program field when programCode is absent', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Legacy point',
        score: 0.8,
        metadata: { callId: 'C-1', program: 'PNRR' },
      },
    ])

    const result = await searchCalls(baseCtx, 'any')

    expect(result.matches[0].program).toBe('PNRR')
  })

  // ── Regression: drop UNKNOWN program chunks ─────────────────────────────
  // 24% of the production corpus (~6.7k chunks) carries programCode=UNKNOWN
  // — classification failures from bulk-ingest. The agent can't reason
  // about a call with no program (no eligibility, no blueprint), so we
  // drop them by default. Falls back to including them if no non-UNKNOWN
  // matches exist (zero-result avoidance).

  it('drops UNKNOWN-program chunks when other matches exist', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'chunk-unknown',
        content: 'Some boilerplate annex',
        score: 0.95,
        metadata: { callId: 'UNK-001', programCode: 'UNKNOWN' },
      },
      {
        id: 'chunk-real',
        content: 'PNRR digital transformation call',
        score: 0.80,
        metadata: { callId: 'PNRR-001', programCode: 'PNRR' },
      },
    ])

    const result = await searchCalls(baseCtx, 'any')

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].callId).toBe('PNRR-001')
    expect(result.matches[0].program).toBe('PNRR')
  })

  it('falls back to UNKNOWN results when no non-UNKNOWN matches are available', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'chunk-unk-1',
        content: 'Boilerplate A',
        score: 0.95,
        metadata: { callId: 'UNK-A', programCode: 'UNKNOWN' },
      },
      {
        id: 'chunk-unk-2',
        content: 'Boilerplate B',
        score: 0.90,
        metadata: { callId: 'UNK-B', programCode: 'UNKNOWN' },
      },
    ])

    const result = await searchCalls(baseCtx, 'any')

    expect(result.matches).toHaveLength(2)
    expect(result.matches[0].program).toBe('UNKNOWN')
  })

  it('keeps UNKNOWN results when includeUnknownProgram: true', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'c1',
        content: 'a',
        score: 0.95,
        metadata: { callId: 'UNK-1', programCode: 'UNKNOWN' },
      },
      {
        id: 'c2',
        content: 'b',
        score: 0.80,
        metadata: { callId: 'PNRR-1', programCode: 'PNRR' },
      },
    ])

    const result = await searchCalls(baseCtx, 'any', { includeUnknownProgram: true })

    expect(result.matches).toHaveLength(2)
    expect(result.matches.map((m) => m.callId).sort()).toEqual(['PNRR-1', 'UNK-1'])
  })

  // ── Regression: per-program cap ─────────────────────────────────────────
  // POTJ has ~4.8k chunks vs PNRR's 303. Without a cap, top-K was filled by
  // multiple POTJ docs and PNRR / other programs never surfaced. Default
  // cap=2 keeps the highest two per program and reserves room for others.

  it('caps results per program at the default (2)', async () => {
    mockSearch.mockResolvedValue([
      { id: 'p1', content: 'a', score: 0.9, metadata: { callId: 'POTJ-A', programCode: 'POTJ' } },
      { id: 'p2', content: 'b', score: 0.85, metadata: { callId: 'POTJ-B', programCode: 'POTJ' } },
      { id: 'p3', content: 'c', score: 0.80, metadata: { callId: 'POTJ-C', programCode: 'POTJ' } },
      { id: 'p4', content: 'd', score: 0.75, metadata: { callId: 'PNRR-A', programCode: 'PNRR' } },
      { id: 'p5', content: 'e', score: 0.70, metadata: { callId: 'POCIDIF-A', programCode: 'POCIDIF' } },
    ])

    const result = await searchCalls(baseCtx, 'any', { maxResults: 5 })

    // POTJ capped at 2; PNRR and POCIDIF surface despite lower scores
    const programs = result.matches.map((m) => m.program)
    const potjCount = programs.filter((p) => p === 'POTJ').length
    expect(potjCount).toBe(2)
    expect(programs).toContain('PNRR')
    expect(programs).toContain('POCIDIF')
  })

  it('respects maxResultsPerProgram override', async () => {
    mockSearch.mockResolvedValue([
      { id: '1', content: 'a', score: 0.9, metadata: { callId: 'A', programCode: 'POTJ' } },
      { id: '2', content: 'b', score: 0.85, metadata: { callId: 'B', programCode: 'POTJ' } },
      { id: '3', content: 'c', score: 0.80, metadata: { callId: 'C', programCode: 'POTJ' } },
    ])

    const result = await searchCalls(baseCtx, 'any', {
      maxResults: 5,
      maxResultsPerProgram: 1,
    })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].callId).toBe('A')
  })

  // Regression for Codex #107 finding: when the caller has narrowed the
  // search to one program (or one call via callId/callCode/sourceId), the
  // per-program cap must not silently truncate the response. The MCP tool
  // surface exposes `program` + `maxResults` but not `maxResultsPerProgram`,
  // so the cap is otherwise unchangeable in that flow.

  it('skips per-program cap when opts.program narrows to one program', async () => {
    mockSearch.mockResolvedValue([
      { id: '1', content: 'a', score: 0.9, metadata: { callId: 'POTJ-A', programCode: 'POTJ' } },
      { id: '2', content: 'b', score: 0.85, metadata: { callId: 'POTJ-B', programCode: 'POTJ' } },
      { id: '3', content: 'c', score: 0.80, metadata: { callId: 'POTJ-C', programCode: 'POTJ' } },
      { id: '4', content: 'd', score: 0.75, metadata: { callId: 'POTJ-D', programCode: 'POTJ' } },
      { id: '5', content: 'e', score: 0.70, metadata: { callId: 'POTJ-E', programCode: 'POTJ' } },
    ])

    const result = await searchCalls(baseCtx, 'any', {
      program: 'POTJ',
      maxResults: 5,
    })

    expect(result.matches).toHaveLength(5)
    expect(result.matches.every((m) => m.program === 'POTJ')).toBe(true)
  })

  it('skips per-program cap when opts.callId narrows to one call', async () => {
    mockSearch.mockResolvedValue([
      { id: '1', content: 'a', score: 0.9, metadata: { callId: 'X', programCode: 'POTJ' } },
      { id: '2', content: 'b', score: 0.85, metadata: { callId: 'X', programCode: 'POTJ' } },
      { id: '3', content: 'c', score: 0.80, metadata: { callId: 'X', programCode: 'POTJ' } },
    ])

    // callId-narrowed search returns 1 deduped match — but the cap should
    // not be the reason. (callId dedup separately collapses to 1.)
    const result = await searchCalls(baseCtx, 'any', {
      callId: 'X',
      maxResults: 5,
    })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].callId).toBe('X')
  })
})

// ── retrieveEvidence tests ─────────────────────────────────────────────────

describe('retrieveEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no programCode resolved → mirrors prior "unfiltered" behavior
    // so existing assertions don't have to know about the helper.
    mockLookupCallProgramCode.mockResolvedValue(null)
  })

  it('returns an EvidenceBundle with the correct callId', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'ev-1',
        content: 'Ghid aplicant PNRR',
        score: 0.95,
        metadata: { documentType: 'ghid', source: 'https://example.com/ghid' },
      },
    ])

    const bundle = await retrieveEvidence(baseCtx, 'PNRR-C11-001')

    expect(bundle.callId).toBe('PNRR-C11-001')
    expect(bundle.chunks).toHaveLength(1)
    expect(bundle.totalChunks).toBe(1)
    expect(bundle.retrievedAt).toEqual(baseCtx.now)
  })

  it('ranks chunks by document type priority (ghid before unknown)', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'ev-unknown',
        content: 'Unknown doc',
        score: 0.99,
        metadata: { documentType: 'unknown' },
      },
      {
        id: 'ev-ghid',
        content: 'Ghid aplicant',
        score: 0.80,
        metadata: { documentType: 'ghid' },
      },
    ])

    const bundle = await retrieveEvidence(baseCtx, 'CALL-001')

    expect(bundle.chunks[0].docType).toBe('ghid')
    expect(bundle.chunks[1].docType).toBe('unknown')
  })

  it('throws ExternalDependencyError on vector store failure', async () => {
    mockSearch.mockRejectedValue(new Error('Qdrant unavailable'))

    await expect(retrieveEvidence(baseCtx, 'CALL-001')).rejects.toBeInstanceOf(ExternalDependencyError)
  })

  // ── Path-D filter behavior ───────────────────────────────────────────────
  // The `{ callId }` filter never matched a single Qdrant point in prod
  // (28,078 points, 0 carry `callId` in payload). retrieveEvidence now
  // resolves the call's parent programCode and filters on that — the axis
  // that ~76% of points actually carry.

  it('filters Qdrant search by programCode resolved from the call', async () => {
    mockLookupCallProgramCode.mockResolvedValue('PNRR')
    mockSearch.mockResolvedValue([
      {
        id: 'ev-1',
        content: 'PNRR programme guide',
        score: 0.9,
        metadata: { documentType: 'ghid', programCode: 'PNRR' },
      },
    ])

    await retrieveEvidence(baseCtx, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { maxChunks: 5 })

    expect(mockLookupCallProgramCode).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    // First call uses the programCode filter
    expect(mockSearch.mock.calls[0][2]).toEqual({ programCode: 'PNRR' })
  })

  it('falls back to unfiltered search when filtered programCode search returns empty', async () => {
    mockLookupCallProgramCode.mockResolvedValue('PEO')
    mockSearch
      .mockResolvedValueOnce([]) // filtered → empty
      .mockResolvedValueOnce([
        {
          id: 'ev-fallback',
          content: 'Fallback content',
          score: 0.6,
          metadata: { documentType: 'unknown' },
        },
      ])

    const bundle = await retrieveEvidence(baseCtx, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')

    expect(mockSearch).toHaveBeenCalledTimes(2)
    expect(mockSearch.mock.calls[0][2]).toEqual({ programCode: 'PEO' })
    expect(mockSearch.mock.calls[1][2]).toBeUndefined()
    expect(bundle.totalChunks).toBe(1)
  })

  it('passes no filter and does not double-search when programCode is unresolvable', async () => {
    mockLookupCallProgramCode.mockResolvedValue(null)
    mockSearch.mockResolvedValue([])

    await retrieveEvidence(baseCtx, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')

    // Single search, no filter — fallback re-query would be redundant.
    expect(mockSearch).toHaveBeenCalledTimes(1)
    expect(mockSearch.mock.calls[0][2]).toBeUndefined()
  })

  it('still resolves a programCode filter when callId is a non-UUID call_code like PDD/216', async () => {
    // Documents the post-Codex-review fix: lookupCallProgramCode accepts the
    // searchCalls fallback-chain identifiers (call_code, sourceId) — not just
    // UUIDs. Without the multi-key resolver in call-program.ts, this case
    // would silently degrade to unfiltered search even for the points we
    // most want narrowed.
    mockLookupCallProgramCode.mockResolvedValue('PDD')
    mockSearch.mockResolvedValue([
      { id: 'pdd-1', content: 'PDD content', score: 0.9, metadata: { documentType: 'ghid', programCode: 'PDD' } },
    ])

    await retrieveEvidence(baseCtx, 'PDD/216')

    expect(mockLookupCallProgramCode).toHaveBeenCalledWith('PDD/216')
    expect(mockSearch.mock.calls[0][2]).toEqual({ programCode: 'PDD' })
  })
})
