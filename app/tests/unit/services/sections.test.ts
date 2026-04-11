// app/tests/unit/services/sections.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted — do NOT reference outer const vars inside them.

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id', sectionKey: 'section_key' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conditions) => ({ conditions })),
}))

// Import AFTER mocks
import { db } from '@/lib/db'
import { listSections, getSection } from '@/lib/ai/agent/services/sections'
import { NotFoundError } from '@/lib/ai/agent/services/errors'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Helpers ────────────────────────────────────────────────────────────────

// Helper: single-call ownership failure (session not found → .limit() returns [])
function setupOwnershipFailure() {
  vi.mocked(db.select).mockImplementation(() => {
    const mockLimit = vi.fn().mockResolvedValue([])
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    return { from: mockFrom } as any
  })
}

// Helper: ownership check (limit) + sections list (no limit)
function setupOwnershipAndSections(sessionRow: unknown, sectionRows: unknown[]) {
  // First call (ownership): limit(), second call (sections): no limit
  let callCount = 0
  vi.mocked(db.select).mockImplementation(() => {
    const isFirst = callCount === 0
    callCount++
    if (isFirst) {
      const mockLimit = vi.fn().mockResolvedValue([sessionRow])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      return { from: mockFrom } as any
    } else {
      // sections: resolves from .where() directly
      const mockWhere = vi.fn().mockResolvedValue(sectionRows)
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      return { from: mockFrom } as any
    }
  })
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const SECTION_ID = '33333333-3333-4333-8333-333333333333'

const baseCtx: ServiceContext = {
  userId: USER_ID,
  requestId: 'req-sections-001',
  now: new Date('2026-04-09T10:00:00Z'),
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    ...overrides,
  }
}

function makeSectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SECTION_ID,
    sessionId: SESSION_ID,
    sectionKey: 'context',
    title: 'Context',
    documentOrder: 1,
    generationOrder: 1,
    status: 'accepted',
    content: 'Section content here',
    acceptedContent: 'Accepted content here',
    modelUsed: 'claude-3-5-sonnet',
    retryCount: 0,
    sourcesUsed: ['source-1', 'source-2'],
    promptVersion: 'v1',
    latencyMs: 1200,
    tokenUsage: { input: 500, output: 300 },
    errorClass: null,
    rejectionReason: null,
    updatedAt: new Date('2026-04-09T09:00:00Z'),
    ...overrides,
  }
}

// ── listSections tests ─────────────────────────────────────────────────────

describe('listSections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when session does not exist', async () => {
    setupOwnershipFailure()

    await expect(listSections(baseCtx, SESSION_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('NotFoundError has resourceType=session and correct resourceId', async () => {
    setupOwnershipFailure()

    const err = await listSections(baseCtx, SESSION_ID).catch(e => e)

    expect(err.resourceType).toBe('session')
    expect(err.resourceId).toBe(SESSION_ID)
  })

  it('throws NotFoundError when session belongs to a different user', async () => {
    // Ownership check filters by userId — wrong user returns no rows
    setupOwnershipFailure()

    const ctxOther: ServiceContext = { ...baseCtx, userId: OTHER_USER_ID }

    await expect(listSections(ctxOther, SESSION_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns empty array when session has no sections', async () => {
    setupOwnershipAndSections(makeSessionRow(), [])

    const result = await listSections(baseCtx, SESSION_ID)

    expect(result).toEqual([])
  })

  it('returns SectionListItem[] with correct shape', async () => {
    const section = makeSectionRow()
    setupOwnershipAndSections(makeSessionRow(), [section])

    const result = await listSections(baseCtx, SESSION_ID)

    expect(result).toHaveLength(1)
    const item = result[0]
    expect(item.id).toBe(SECTION_ID)
    expect(item.sessionId).toBe(SESSION_ID)
    expect(item.sectionKey).toBe('context')
    expect(item.title).toBe('Context')
    expect(item.documentOrder).toBe(1)
    expect(item.generationOrder).toBe(1)
    expect(item.status).toBe('accepted')
    expect(item.retryCount).toBe(0)
    expect(item.updatedAt).toEqual(section.updatedAt)
  })

  it('does not include content or acceptedContent in SectionListItem', async () => {
    const section = makeSectionRow()
    setupOwnershipAndSections(makeSessionRow(), [section])

    const result = await listSections(baseCtx, SESSION_ID)

    expect(result[0]).not.toHaveProperty('content')
    expect(result[0]).not.toHaveProperty('acceptedContent')
  })

  it('returns multiple sections when present', async () => {
    const s1 = makeSectionRow({ sectionKey: 'context', documentOrder: 1 })
    const s2 = makeSectionRow({ id: '44444444-4444-4444-8444-444444444444', sectionKey: 'summary', documentOrder: 2 })
    setupOwnershipAndSections(makeSessionRow(), [s1, s2])

    const result = await listSections(baseCtx, SESSION_ID)

    expect(result).toHaveLength(2)
    expect(result.map(r => r.sectionKey)).toEqual(['context', 'summary'])
  })
})

// ── getSection tests ───────────────────────────────────────────────────────

// Helper: both ownership check (limit) AND section detail query (limit) use .limit()
function setupGetSectionSequence(sessionRows: unknown[], sectionRows: unknown[]) {
  let callCount = 0
  vi.mocked(db.select).mockImplementation(() => {
    const response = callCount === 0 ? sessionRows : sectionRows
    callCount++
    const mockLimit = vi.fn().mockResolvedValue(response)
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    return { from: mockFrom } as any
  })
}

describe('getSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when session does not exist (ownership check fails)', async () => {
    setupGetSectionSequence([], [])

    await expect(getSection(baseCtx, SESSION_ID, 'context')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when section not found in the session', async () => {
    setupGetSectionSequence([makeSessionRow()], [])

    await expect(getSection(baseCtx, SESSION_ID, 'nonexistent')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('NotFoundError for missing section has resourceType=section', async () => {
    setupGetSectionSequence([makeSessionRow()], [])

    const err = await getSection(baseCtx, SESSION_ID, 'nonexistent').catch(e => e)

    expect(err.resourceType).toBe('section')
  })

  it('returns SectionDetail with all fields for an existing section', async () => {
    const section = makeSectionRow()
    setupGetSectionSequence([makeSessionRow()], [section])

    const detail = await getSection(baseCtx, SESSION_ID, 'context')

    expect(detail.id).toBe(SECTION_ID)
    expect(detail.sessionId).toBe(SESSION_ID)
    expect(detail.sectionKey).toBe('context')
    expect(detail.title).toBe('Context')
    expect(detail.content).toBe('Section content here')
    expect(detail.acceptedContent).toBe('Accepted content here')
    expect(detail.modelUsed).toBe('claude-3-5-sonnet')
    expect(detail.sourcesUsed).toEqual(['source-1', 'source-2'])
    expect(detail.promptVersion).toBe('v1')
    expect(detail.latencyMs).toBe(1200)
    expect(detail.tokenUsage).toEqual({ input: 500, output: 300 })
    expect(detail.errorClass).toBeNull()
  })

  it('maps null optional fields correctly', async () => {
    const section = makeSectionRow({
      content: null,
      acceptedContent: null,
      modelUsed: null,
      sourcesUsed: null,
      promptVersion: null,
      latencyMs: null,
      tokenUsage: null,
      errorClass: null,
      rejectionReason: null,
    })
    setupGetSectionSequence([makeSessionRow()], [section])

    const detail = await getSection(baseCtx, SESSION_ID, 'context')

    expect(detail.content).toBeNull()
    expect(detail.acceptedContent).toBeNull()
    expect(detail.modelUsed).toBeNull()
    expect(detail.sourcesUsed).toBeNull()
    expect(detail.promptVersion).toBeNull()
    expect(detail.latencyMs).toBeNull()
    expect(detail.tokenUsage).toBeNull()
    expect(detail.errorClass).toBeNull()
    expect(detail.rejectionReason).toBeNull()
  })

  it('returns rejectionReason in SectionDetail for rejected sections', async () => {
    const section = makeSectionRow({
      status: 'rejected',
      rejectionReason: 'not specific enough',
    })
    setupGetSectionSequence([makeSessionRow()], [section])

    const detail = await getSection(baseCtx, SESSION_ID, 'context')

    expect(detail.status).toBe('rejected')
    expect(detail.rejectionReason).toBe('not specific enough')
  })

  it('returns null rejectionReason for non-rejected sections', async () => {
    const section = makeSectionRow({
      status: 'draft',
      rejectionReason: null,
    })
    setupGetSectionSequence([makeSessionRow()], [section])

    const detail = await getSection(baseCtx, SESSION_ID, 'context')

    expect(detail.status).toBe('draft')
    expect(detail.rejectionReason).toBeNull()
  })
})
