// app/tests/unit/services/freshness.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted — do NOT reference outer const vars inside them.

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  callKnowledge: { callId: 'call_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn(),
}))

vi.mock('@/lib/ai/model-routing', () => ({
  resolveAgentModel: vi.fn(() => ({ provider: 'perplexity', model: 'sonar' })),
}))

vi.mock('@/lib/ai/agent/utils', () => ({
  parseAIJson: vi.fn((content: string) => JSON.parse(content)),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

// Import AFTER mocks
import { db } from '@/lib/db'
import { generate } from '@/lib/ai/providers/router'
import { parseAIJson } from '@/lib/ai/agent/utils'
import { refreshCallFreshness, verifyDeadline, checkCallPageUpdates } from '@/lib/ai/agent/services/freshness'
import { ExternalDependencyError, NotFoundError } from '@/lib/ai/agent/services/errors'
import type { ServiceContext } from '@/lib/ai/agent/services/types'
import { createHash } from 'crypto'

// ── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-09T10:00:00Z')

const baseCtx: ServiceContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  requestId: 'req-freshness-001',
  now: NOW,
}

function makeCallRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    callId: 'PNRR-C11',
    program: 'PNRR',
    callTitle: 'Green Energy Transition',
    normalized: { requiredSections: [], deadline: '2026-12-31' },
    status: 'provisional',
    extractedFrom: 'qdrant_obsidian',
    structureConfidence: 0.8,
    freshnessConfidence: 0.7,
    sourceDocs: ['https://example.com/guide.pdf'],
    fieldProvenance: {},
    contentExtractedAt: new Date('2026-04-01T00:00:00Z'),
    freshnessCheckedAt: null,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides,
  }
}

// DB mock helpers

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

function setupDbUpdate() {
  const mockWhere = vi.fn().mockResolvedValue(undefined)
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
  vi.mocked(db.update).mockReturnValue({ set: mockSet } as any)
  return { mockSet, mockWhere }
}

function setupDbUpdateError(error: Error) {
  const mockWhere = vi.fn().mockRejectedValue(error)
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
  vi.mocked(db.update).mockReturnValue({ set: mockSet } as any)
}

// AI provider mock helpers

function setupAISuccess(parsed: object) {
  vi.mocked(generate).mockResolvedValue({
    content: JSON.stringify(parsed),
    tokensUsed: { input: 100, output: 50 },
    model: 'sonar',
    provider: 'perplexity',
  } as any)
  vi.mocked(parseAIJson).mockReturnValue(parsed as any)
}

function setupAIError(error: Error) {
  vi.mocked(generate).mockRejectedValue(error)
}

// ── refreshCallFreshness tests ─────────────────────────────────────────────

describe('refreshCallFreshness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDbSelect([makeCallRow()])
    setupDbUpdate()
    setupAISuccess({ isOpen: true, amendments: [], warnings: [], confidence: 0.8 })
  })

  it('returns FreshnessCheckResult on success', async () => {
    const result = await refreshCallFreshness(baseCtx, 'PNRR-C11')

    expect(result.isOpen).toBe(true)
    expect(result.amendments).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.freshnessConfidence).toBe(0.8)
    expect(typeof result.checkedAt).toBe('string')
    expect(result.checkedAt).toBe(NOW.toISOString())
  })

  it('returns amendments and warnings from AI response', async () => {
    setupAISuccess({
      isOpen: false,
      amendments: ['Deadline extended to 2027-01-01'],
      warnings: ['Call may be suspended'],
      confidence: 0.6,
    })

    const result = await refreshCallFreshness(baseCtx, 'PNRR-C11')

    expect(result.isOpen).toBe(false)
    expect(result.amendments).toContain('Deadline extended to 2027-01-01')
    expect(result.warnings).toContain('Call may be suspended')
    expect(result.freshnessConfidence).toBe(0.6)
  })

  it('defaults freshnessConfidence to 0.5 when confidence is absent from AI response', async () => {
    setupAISuccess({ isOpen: true, amendments: [], warnings: [] })
    vi.mocked(parseAIJson).mockReturnValue({ isOpen: true, amendments: [], warnings: [] } as any)

    const result = await refreshCallFreshness(baseCtx, 'PNRR-C11')

    expect(result.freshnessConfidence).toBe(0.5)
  })

  it('uses warning fallback when AI response cannot be parsed', async () => {
    vi.mocked(parseAIJson).mockImplementation(() => {
      throw new Error('not JSON')
    })

    const result = await refreshCallFreshness(baseCtx, 'PNRR-C11')

    expect(result.isOpen).toBe(true)
    expect(result.warnings).toContain('Could not parse freshness response')
  })

  it('throws ExternalDependencyError when AI provider fails', async () => {
    setupAIError(new Error('Perplexity down'))

    await expect(refreshCallFreshness(baseCtx, 'PNRR-C11')).rejects.toBeInstanceOf(ExternalDependencyError)
  })

  it('does not throw when DB metadata lookup fails (graceful degradation)', async () => {
    setupDbSelectError(new Error('DB unavailable'))
    setupDbUpdate()
    setupAISuccess({ isOpen: true, amendments: [], warnings: [], confidence: 0.7 })

    // Should still succeed — callId used as title fallback
    const result = await refreshCallFreshness(baseCtx, 'PNRR-C11')
    expect(result.isOpen).toBe(true)
  })

  it('does not throw when DB update fails (non-fatal warning)', async () => {
    setupDbSelect([makeCallRow()])
    setupDbUpdateError(new Error('DB write failed'))

    // Should succeed — update failure is non-fatal
    const result = await refreshCallFreshness(baseCtx, 'PNRR-C11')
    expect(result.isOpen).toBe(true)
  })
})

// ── verifyDeadline tests ───────────────────────────────────────────────────

describe('verifyDeadline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns DeadlineVerification with open status for future deadline', async () => {
    // Deadline 265 days after NOW (2026-04-09)
    setupDbSelect([makeCallRow({ normalized: { deadline: '2026-12-31' } })])

    const result = await verifyDeadline(baseCtx, 'PNRR-C11')

    expect(result.callId).toBe('PNRR-C11')
    expect(result.isOpen).toBe(true)
    expect(result.currentDeadline).toBe('2026-12-31')
    expect(result.verifiedAt).toBe(NOW.toISOString())
    expect(result.warnings).toHaveLength(0)
  })

  it('returns closed status for past deadline', async () => {
    setupDbSelect([makeCallRow({ normalized: { deadline: '2026-01-01' } })])

    const result = await verifyDeadline(baseCtx, 'PNRR-C11')

    expect(result.isOpen).toBe(false)
    expect(result.warnings.some(w => w.includes('Deadline passed'))).toBe(true)
  })

  it('adds closing_soon warning when daysRemaining <= 14', async () => {
    // 5 days from NOW
    setupDbSelect([makeCallRow({ normalized: { deadline: '2026-04-14' } })])

    const result = await verifyDeadline(baseCtx, 'PNRR-C11')

    expect(result.isOpen).toBe(true)
    expect(result.warnings.some(w => w.includes('Closing soon'))).toBe(true)
  })

  it('does not add closing_soon warning when daysRemaining > 14', async () => {
    // 30 days from NOW
    setupDbSelect([makeCallRow({ normalized: { deadline: '2026-05-09' } })])

    const result = await verifyDeadline(baseCtx, 'PNRR-C11')

    expect(result.isOpen).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('warns and marks isOpen true when deadline is missing from blueprint', async () => {
    setupDbSelect([makeCallRow({ normalized: {} })])

    const result = await verifyDeadline(baseCtx, 'PNRR-C11')

    expect(result.currentDeadline).toBeNull()
    expect(result.warnings.some(w => w.includes('No deadline found'))).toBe(true)
    // Open is true when unknown — caller should run freshness check
    expect(result.isOpen).toBe(true)
  })

  it('warns when deadline cannot be parsed as a date', async () => {
    setupDbSelect([makeCallRow({ normalized: { deadline: 'not-a-date' } })])

    const result = await verifyDeadline(baseCtx, 'PNRR-C11')

    expect(result.warnings.some(w => w.includes('could not be parsed'))).toBe(true)
  })

  it('reads deadline from submissionDeadline field as fallback', async () => {
    setupDbSelect([makeCallRow({ normalized: { submissionDeadline: '2026-12-31' } })])

    const result = await verifyDeadline(baseCtx, 'PNRR-C11')

    expect(result.currentDeadline).toBe('2026-12-31')
  })

  it('throws NotFoundError when callId does not exist in DB', async () => {
    setupDbSelect([])

    await expect(verifyDeadline(baseCtx, 'UNKNOWN-CALL')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ExternalDependencyError when DB lookup fails', async () => {
    setupDbSelectError(new Error('DB connection lost'))

    await expect(verifyDeadline(baseCtx, 'PNRR-C11')).rejects.toBeInstanceOf(ExternalDependencyError)
  })
})

// ── checkCallPageUpdates tests ─────────────────────────────────────────────

describe('checkCallPageUpdates', () => {
  const NORMALIZED = { requiredSections: [], deadline: '2026-12-31' }
  const CURRENT_HASH = createHash('sha256').update(JSON.stringify(NORMALIZED)).digest('hex')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns hasChanged=false when hashes match', async () => {
    setupDbSelect([makeCallRow({ normalized: NORMALIZED })])

    const result = await checkCallPageUpdates(baseCtx, 'PNRR-C11', CURRENT_HASH)

    expect(result.hasChanged).toBe(false)
    expect(result.currentHash).toBe(CURRENT_HASH)
    expect(result.previousHash).toBe(CURRENT_HASH)
    expect(result.diffSummary).toBeNull()
  })

  it('returns hasChanged=true when hashes differ', async () => {
    setupDbSelect([makeCallRow({ normalized: NORMALIZED })])
    const oldHash = 'aaaa1234' + '0'.repeat(56) // different hash

    const result = await checkCallPageUpdates(baseCtx, 'PNRR-C11', oldHash)

    expect(result.hasChanged).toBe(true)
    expect(result.currentHash).toBe(CURRENT_HASH)
    expect(result.previousHash).toBe(oldHash)
    expect(result.diffSummary).not.toBeNull()
  })

  it('returns correct callId and checkedAt', async () => {
    setupDbSelect([makeCallRow({ normalized: NORMALIZED })])

    const result = await checkCallPageUpdates(baseCtx, 'PNRR-C11', CURRENT_HASH)

    expect(result.callId).toBe('PNRR-C11')
    expect(result.checkedAt).toEqual(NOW)
  })

  it('uses first sourceDoc as sourceUrl when available', async () => {
    setupDbSelect([makeCallRow({
      normalized: NORMALIZED,
      sourceDocs: ['https://example.com/call.pdf'],
    })])

    const result = await checkCallPageUpdates(baseCtx, 'PNRR-C11', CURRENT_HASH)

    expect(result.sourceUrl).toBe('https://example.com/call.pdf')
  })

  it('falls back to callKnowledge:callId as sourceUrl when sourceDocs is empty', async () => {
    setupDbSelect([makeCallRow({ normalized: NORMALIZED, sourceDocs: [] })])

    const result = await checkCallPageUpdates(baseCtx, 'PNRR-C11', CURRENT_HASH)

    expect(result.sourceUrl).toBe('callKnowledge:PNRR-C11')
  })

  it('hash is deterministic: same normalized JSON produces same hash', async () => {
    setupDbSelect([makeCallRow({ normalized: NORMALIZED })])

    const r1 = await checkCallPageUpdates(baseCtx, 'PNRR-C11', 'any-old-hash')
    setupDbSelect([makeCallRow({ normalized: NORMALIZED })])
    const r2 = await checkCallPageUpdates(baseCtx, 'PNRR-C11', 'any-old-hash')

    expect(r1.currentHash).toBe(r2.currentHash)
  })

  it('hash changes when normalized content changes', async () => {
    setupDbSelect([makeCallRow({ normalized: NORMALIZED })])
    const r1 = await checkCallPageUpdates(baseCtx, 'PNRR-C11', 'old')

    setupDbSelect([makeCallRow({ normalized: { ...NORMALIZED, deadline: '2027-01-01' } })])
    const r2 = await checkCallPageUpdates(baseCtx, 'PNRR-C11', 'old')

    expect(r1.currentHash).not.toBe(r2.currentHash)
  })

  it('throws NotFoundError when callId does not exist in DB', async () => {
    setupDbSelect([])

    await expect(checkCallPageUpdates(baseCtx, 'UNKNOWN', 'any')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ExternalDependencyError when DB lookup fails', async () => {
    setupDbSelectError(new Error('DB down'))

    await expect(checkCallPageUpdates(baseCtx, 'PNRR-C11', 'any')).rejects.toBeInstanceOf(ExternalDependencyError)
  })
})
