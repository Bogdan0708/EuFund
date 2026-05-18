// app/tests/unit/services/call-program.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
// The helper layers three lookups (id → call_code → external_id) via a chained
// drizzle query. We stub the chain in a way that lets each test control what
// the FROM().INNER_JOIN().WHERE().LIMIT() resolves to per call. The mock
// returns an iterable of promises in the order .select() is invoked, so the
// test author can script different outcomes for each branch.

const selectCalls: Array<Promise<unknown[]>> = []

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => {
      const nextResult = selectCalls.shift() ?? Promise.resolve([])
      // Each .select() chain ends at .limit(); intermediate methods just
      // return the same builder. Resolving on `.limit()` lets the helper
      // await the result the same way it would against real drizzle.
      const builder: Record<string, unknown> = {}
      builder.from = vi.fn(() => builder)
      builder.innerJoin = vi.fn(() => builder)
      builder.where = vi.fn(() => builder)
      builder.limit = vi.fn(() => nextResult)
      return builder
    }),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  callsForProposals: {
    id: 'id',
    callCode: 'call_code',
    externalId: 'external_id',
    programId: 'program_id',
  },
  fundingPrograms: { id: 'id', code: 'code' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ warn: vi.fn() }) },
}))

// Import AFTER mocks
import { lookupCallProgramCode } from '@/lib/ai/agent/services/call-program'
import { db } from '@/lib/db'

// ── Helpers ────────────────────────────────────────────────────────────────

function queueSelectResults(...batches: unknown[][]): void {
  for (const b of batches) selectCalls.push(Promise.resolve(b))
}

function queueSelectError(error: Error): void {
  selectCalls.push(Promise.reject(error))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('lookupCallProgramCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectCalls.length = 0
  })

  // ── UUID-shape branch ────────────────────────────────────────────────────

  it('resolves a UUID id to the parent program code', async () => {
    queueSelectResults([{ code: 'PDD' }])

    const code = await lookupCallProgramCode('66c935aa-507b-4821-88b1-17098fef074d')

    expect(code).toBe('PDD')
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1)
  })

  it('returns null when a UUID-shaped id has no matching call (does NOT fall through to call_code)', async () => {
    // UUID-shape that doesn't resolve is almost certainly a Qdrant point ID,
    // not a calls_for_proposals.id. Falling through to call_code would do an
    // extra DB query that can never match (call codes are never UUID-shaped).
    queueSelectResults([])

    const code = await lookupCallProgramCode('00001b67-79dc-46de-2a54-d291b2e599da')

    expect(code).toBeNull()
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1)
  })

  // ── call_code branch ────────────────────────────────────────────────────

  it('resolves a non-UUID identifier via call_code (PDD/216 → PDD)', async () => {
    // First select() is the call_code lookup (UUID branch is skipped by shape)
    queueSelectResults([{ code: 'PDD' }])

    const code = await lookupCallProgramCode('PDD/216')

    expect(code).toBe('PDD')
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1)
  })

  it('falls through to external_id when call_code misses', async () => {
    queueSelectResults([], [{ code: 'POIM' }])

    const code = await lookupCallProgramCode('EXT-12345')

    expect(code).toBe('POIM')
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(2)
  })

  // ── external_id branch ──────────────────────────────────────────────────

  it('returns null when external_id is ambiguous (2+ rows match)', async () => {
    // Composite-unique on (source_connector_id, external_id) — the same
    // external_id CAN repeat across connectors. The LIMIT 2 probe + the
    // `length === 1` check is the ambiguity safety net.
    queueSelectResults(
      [],                                          // call_code miss
      [{ code: 'PNRR' }, { code: 'POTJ' }],        // external_id: 2 rows
    )

    const code = await lookupCallProgramCode('SHARED-EXT-ID')

    expect(code).toBeNull()
  })

  it('returns null when no branch matches (sha256-shaped sourceId)', async () => {
    // A 64-char hex content hash doesn't match UUID shape, call_code, or
    // external_id. The agent should fall back to unfiltered search.
    queueSelectResults([], [])

    const code = await lookupCallProgramCode(
      'e39354c0c12c1400cf40cbaefa2da6bfc594d081a9a88105cb3404c1b9a6466b',
    )

    expect(code).toBeNull()
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(2)
  })

  // ── Error handling ──────────────────────────────────────────────────────

  it('returns null when the DB throws (graceful degradation)', async () => {
    queueSelectError(new Error('connection refused'))

    const code = await lookupCallProgramCode('PDD/216')

    expect(code).toBeNull()
  })

  // ── Shape edge cases ────────────────────────────────────────────────────

  it('treats uppercase-hex UUIDs as UUID-shaped (case-insensitive)', async () => {
    queueSelectResults([{ code: 'PEO' }])

    const code = await lookupCallProgramCode('66C935AA-507B-4821-88B1-17098FEF074D')

    expect(code).toBe('PEO')
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1)
  })

  it('does not treat a 64-char hex hash as UUID-shaped', async () => {
    // No dashes, 64 chars instead of 36. Must go down the call_code path
    // (which will miss), not the id path.
    queueSelectResults([], [])

    const code = await lookupCallProgramCode(
      'e39354c0c12c1400cf40cbaefa2da6bfc594d081a9a88105cb3404c1b9a6466b',
    )

    expect(code).toBeNull()
    // Two queries (call_code + external_id), NOT the single-query UUID path.
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(2)
  })
})
