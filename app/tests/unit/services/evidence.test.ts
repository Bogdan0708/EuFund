import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSearch = vi.fn()

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(() => ({ search: mockSearch })),
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
    // Return 6 unique results from the store
    const storeResults = Array.from({ length: 6 }, (_, i) => ({
      id: `chunk-${i}`,
      content: `Content for call ${i}`,
      score: 0.9 - i * 0.05,
      metadata: { callId: `CALL-00${i}`, callTitle: `Call ${i}`, program: 'PEO' },
    }))
    mockSearch.mockResolvedValue(storeResults)

    const result = await searchCalls(baseCtx, 'digital transformation', { maxResults: 3 })

    expect(result.matches).toHaveLength(3)
  })

  it('passes program filter to vector store', async () => {
    mockSearch.mockResolvedValue([makeResult({ program: 'POTJ' })])

    await searchCalls(baseCtx, 'tourism', { program: 'POTJ' })

    const [, , filter] = mockSearch.mock.calls[0]
    expect(filter).toEqual({ program: 'POTJ' })
  })

  it('passes no filter when program is omitted', async () => {
    mockSearch.mockResolvedValue([makeResult()])

    await searchCalls(baseCtx, 'green energy')

    const [, , filter] = mockSearch.mock.calls[0]
    expect(filter).toBeUndefined()
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
})

// ── retrieveEvidence tests ─────────────────────────────────────────────────

describe('retrieveEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
