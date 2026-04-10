// app/tests/unit/services/blueprint.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted — do NOT reference outer const vars inside them.

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  callKnowledge: { callId: 'call_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}))

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

// Import AFTER mocks
import { db } from '@/lib/db'
import { getVectorStore } from '@/lib/vectors/store'
import { lookupBlueprint, saveCallBlueprint } from '@/lib/ai/agent/services/blueprint'
import { ExternalDependencyError } from '@/lib/ai/agent/services/errors'
import type { ServiceContext } from '@/lib/ai/agent/services/types'
import type { CallBlueprint } from '@/lib/ai/orchestrator/types'

// ── Helpers to configure mocks ────────────────────────────────────────────

function setupDbSelect(rows: unknown[]) {
  const mockLimit = vi.fn().mockResolvedValue(rows)
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)
  return { mockLimit, mockWhere, mockFrom }
}

function setupDbSelectError(error: Error) {
  const mockLimit = vi.fn().mockRejectedValue(error)
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)
}

function setupDbInsert() {
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
  vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any)
  return { mockOnConflictDoUpdate, mockValues }
}

function setupDbInsertError(error: Error) {
  const mockOnConflictDoUpdate = vi.fn().mockRejectedValue(error)
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
  vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any)
}

function setupVectorStore(results: unknown[]) {
  const mockSearch = vi.fn().mockResolvedValue(results)
  vi.mocked(getVectorStore).mockReturnValue({ search: mockSearch } as any)
  return { mockSearch }
}

function setupVectorStoreError(error: Error) {
  const mockSearch = vi.fn().mockRejectedValue(error)
  vi.mocked(getVectorStore).mockReturnValue({ search: mockSearch } as any)
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const baseCtx: ServiceContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  requestId: 'req-blueprint-001',
  now: new Date('2026-04-09T10:00:00Z'),
}

function makeCacheRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    callId: 'PNRR-C11',
    program: 'PNRR',
    callTitle: 'Green Energy Transition',
    normalized: {
      requiredSections: [{ title: 'Context', description: 'Describe context' }],
      mandatoryAnnexes: [],
      eligibilityCriteria: [],
      evaluationGrid: [],
      cofinancingRate: 0.85,
    },
    status: 'primed',
    extractedFrom: 'qdrant_obsidian',
    structureConfidence: 0.8,
    freshnessConfidence: 0.7,
    sourceDocs: ['guide.pdf'],
    fieldProvenance: {},
    contentExtractedAt: new Date('2026-04-01T00:00:00Z'),
    freshnessCheckedAt: null,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides,
  }
}

function makeEvidenceResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chunk-1',
    content: 'Ghid aplicant section content',
    score: 0.9,
    metadata: {
      documentType: 'ghid',
      source: 'https://example.com/guide.pdf',
      callId: 'PNRR-C11',
    },
    ...overrides,
  }
}

// ── lookupBlueprint tests ──────────────────────────────────────────────────

describe('lookupBlueprint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: empty DB rows, empty vector store
    setupDbSelect([])
    setupVectorStore([])
  })

  it('returns cached blueprint when confidence >= 0.4', async () => {
    setupDbSelect([makeCacheRow({ structureConfidence: 0.8 })])

    const result = await lookupBlueprint(baseCtx, 'PNRR-C11')

    expect(result.cached).toBe(true)
    expect(result.blueprint).not.toBeNull()
    expect(result.blueprint!.callId).toBe('PNRR-C11')
    expect(result.blueprint!.program).toBe('PNRR')
    expect(result.rawEvidence).toBeNull()
  })

  it('returns cached blueprint exactly at the 0.4 confidence threshold', async () => {
    setupDbSelect([makeCacheRow({ structureConfidence: 0.4 })])

    const result = await lookupBlueprint(baseCtx, 'PNRR-C11')

    expect(result.cached).toBe(true)
    expect(result.blueprint).not.toBeNull()
  })

  it('returns raw evidence when cache confidence is below 0.4', async () => {
    setupDbSelect([makeCacheRow({ structureConfidence: 0.3 })])
    setupVectorStore([makeEvidenceResult()])

    const result = await lookupBlueprint(baseCtx, 'PNRR-C11')

    expect(result.cached).toBe(false)
    expect(result.blueprint).toBeNull()
    expect(result.rawEvidence).not.toBeNull()
    expect(result.rawEvidence!.length).toBeGreaterThan(0)
  })

  it('returns raw evidence when no cache row exists', async () => {
    setupDbSelect([])
    setupVectorStore([makeEvidenceResult()])

    const result = await lookupBlueprint(baseCtx, 'PNRR-C11')

    expect(result.cached).toBe(false)
    expect(result.blueprint).toBeNull()
    expect(result.rawEvidence).not.toBeNull()
  })

  it('cache miss result has correct shape: { cached: false, blueprint: null, rawEvidence: [...] }', async () => {
    setupDbSelect([])
    setupVectorStore([
      makeEvidenceResult({ id: 'c1', metadata: { documentType: 'ghid', source: 'a.pdf' } }),
      makeEvidenceResult({ id: 'c2', metadata: { documentType: 'anexa', source: 'b.pdf' } }),
    ])

    const result = await lookupBlueprint(baseCtx, 'PNRR-C11')

    expect(result).toMatchObject({
      cached: false,
      blueprint: null,
    })
    expect(Array.isArray(result.rawEvidence)).toBe(true)
    expect(result.rawEvidence!.length).toBe(2)

    // Verify EvidenceChunk shape
    const chunk = result.rawEvidence![0]
    expect(chunk).toHaveProperty('id')
    expect(chunk).toHaveProperty('content')
    expect(chunk).toHaveProperty('docType')
    expect(chunk).toHaveProperty('source')
    expect(chunk).toHaveProperty('score')
    expect(chunk).toHaveProperty('priority')
  })

  it('falls back to broader Qdrant search when filtered search returns empty', async () => {
    setupDbSelect([])
    const mockSearch = vi.fn()
      .mockResolvedValueOnce([])              // filtered search → empty
      .mockResolvedValueOnce([makeEvidenceResult()]) // broader search → results
    vi.mocked(getVectorStore).mockReturnValue({ search: mockSearch } as any)

    const result = await lookupBlueprint(baseCtx, 'PNRR-C11')

    expect(result.cached).toBe(false)
    expect(result.rawEvidence!.length).toBeGreaterThan(0)
    expect(mockSearch).toHaveBeenCalledTimes(2)
  })

  it('sorts raw evidence by document type priority (ghid before unknown)', async () => {
    setupDbSelect([])
    setupVectorStore([
      { id: 'unknown-chunk', content: 'Unknown doc', score: 0.99, metadata: { documentType: 'unknown', source: 'x.pdf' } },
      { id: 'ghid-chunk', content: 'Ghid aplicant', score: 0.80, metadata: { documentType: 'ghid', source: 'y.pdf' } },
    ])

    const result = await lookupBlueprint(baseCtx, 'PNRR-C11')

    // ghid (priority 1) should come before unknown (priority 10)
    expect(result.rawEvidence![0].docType).toBe('ghid')
    expect(result.rawEvidence![1].docType).toBe('unknown')
  })

  it('throws ExternalDependencyError when vector store is unavailable', async () => {
    setupDbSelect([])
    setupVectorStoreError(new Error('Qdrant connection refused'))

    await expect(lookupBlueprint(baseCtx, 'PNRR-C11')).rejects.toBeInstanceOf(ExternalDependencyError)
  })

  it('proceeds to Qdrant when DB cache check fails (graceful degradation)', async () => {
    setupDbSelectError(new Error('DB connection lost'))
    setupVectorStore([makeEvidenceResult()])

    // Should NOT throw — DB error is caught and falls through to Qdrant
    const result = await lookupBlueprint(baseCtx, 'PNRR-C11')

    expect(result.cached).toBe(false)
    expect(result.rawEvidence!.length).toBeGreaterThan(0)
  })
})

// ── saveCallBlueprint tests ────────────────────────────────────────────────

describe('saveCallBlueprint', () => {
  const mockBlueprint: CallBlueprint = {
    callId: 'PNRR-C11',
    program: 'PNRR',
    isOpen: true,
    amendments: [],
    warnings: [],
    requiredSections: [{ title: 'Context', description: 'Describe context' }],
    mandatoryAnnexes: [],
    eligibilityCriteria: [],
    evaluationGrid: [],
    cofinancingRate: 0.85,
    eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
    sources: ['guide.pdf'],
    verifiedAt: '2026-04-09T10:00:00.000Z',
    raw: { notebookLmResponse: '', perplexityResponse: '', retrievedAt: '2026-04-09T10:00:00.000Z' },
    normalized: {
      requiredSections: [{ id: 'ctx', title: 'Context', description: 'Desc', order: 1, generationOrder: 1, importance: 'critical', expectedLength: 'long', dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 0.9 }],
      mandatoryAnnexes: [],
      eligibilityCriteria: [],
      evaluationGrid: [],
      cofinancingRate: 0.85,
    },
    structureConfidence: 0.75,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setupDbInsert()
  })

  it('returns a BlueprintSaveResult with callId, version, contentHash, persistedAt', async () => {
    const result = await saveCallBlueprint(baseCtx, 'PNRR-C11', mockBlueprint)

    expect(result.callId).toBe('PNRR-C11')
    expect(result.version).toBe(1)
    expect(typeof result.contentHash).toBe('string')
    expect(result.contentHash.length).toBe(64) // SHA-256 hex is 64 chars
    expect(result.persistedAt).toEqual(baseCtx.now)
  })

  it('contentHash is a SHA-256 hex string derived from normalized data', async () => {
    const result = await saveCallBlueprint(baseCtx, 'PNRR-C11', mockBlueprint)

    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('contentHash is deterministic for the same blueprint', async () => {
    const result1 = await saveCallBlueprint(baseCtx, 'PNRR-C11', mockBlueprint)
    const result2 = await saveCallBlueprint(baseCtx, 'PNRR-C11', mockBlueprint)

    expect(result1.contentHash).toBe(result2.contentHash)
  })

  it('calls db.insert with correct callId and program', async () => {
    const { mockValues } = setupDbInsert()

    await saveCallBlueprint(baseCtx, 'PNRR-C11', mockBlueprint)

    expect(vi.mocked(db.insert)).toHaveBeenCalledOnce()
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'PNRR-C11', program: 'PNRR' }),
    )
  })

  it('throws ExternalDependencyError when DB upsert fails', async () => {
    setupDbInsertError(new Error('DB connection lost'))

    await expect(saveCallBlueprint(baseCtx, 'PNRR-C11', mockBlueprint)).rejects.toBeInstanceOf(ExternalDependencyError)
  })
})
