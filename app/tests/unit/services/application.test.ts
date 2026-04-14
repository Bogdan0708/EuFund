// app/tests/unit/services/application.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted — do NOT reference outer const vars inside them.

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id', sessionId: 'session_id' },
  agentSections: { sessionId: 'session_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conditions) => ({ conditions })),
}))

// Import AFTER mocks
import { db } from '@/lib/db'
import { getApplicationState, getValidationReport } from '@/lib/ai/agent/services/application'
import { NotFoundError } from '@/lib/ai/agent/services/errors'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sets up db.select() chain for two sequential calls:
 *   1st call  → session query: .from().where().limit() → sessionRows
 *   2nd call  → sections query: .from().where()        → sectionRows (Promise)
 *
 * The sections query resolves directly from `.where()` (no `.limit()`).
 */
function setupDbSelect(sessionRows: unknown[], sectionRows: unknown[] = []) {
  let callCount = 0
  vi.mocked(db.select).mockImplementation(() => {
    const isSessionQuery = callCount === 0
    callCount++

    if (isSessionQuery) {
      // Session query uses .where().limit()
      const mockLimit = vi.fn().mockResolvedValue(sessionRows)
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      return { from: mockFrom } as any
    } else {
      // Sections query uses .where() (no .limit())
      const mockWhere = vi.fn().mockResolvedValue(sectionRows)
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      return { from: mockFrom } as any
    }
  })
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const BASE_USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

const baseCtx: ServiceContext = {
  userId: BASE_USER_ID,
  requestId: 'req-application-001',
  now: new Date('2026-04-09T10:00:00Z'),
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    userId: BASE_USER_ID,
    projectId: null,
    status: 'active',
    locale: 'ro',
    selectedCallId: 'PNRR-C11',
    currentPhase: 'drafting',
    blueprint: null,
    eligibility: { eligible: true, score: 0.85, failCount: 0, warningCount: 1 },
    outline: null,
    warnings: [{ code: 'W001', message: 'Minor issue', severity: 'low' }],
    planningArtifact: null,
    outlineFrozen: false,
    messageSummary: null,
    stateVersion: 3,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: new Date('2026-04-09T09:00:00Z'),
    ...overrides,
  }
}

function makeSection(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    sessionId: SESSION_ID,
    sectionKey: 'context',
    title: 'Context',
    documentOrder: 1,
    generationOrder: 1,
    status: 'accepted',
    content: 'Section content',
    acceptedContent: 'Section content',
    modelUsed: 'claude-3-5-sonnet',
    retryCount: 0,
    sourcesUsed: [],
    promptVersion: 'v1',
    latencyMs: 1200,
    tokenUsage: { input: 500, output: 300 },
    errorClass: null,
    updatedAt: new Date('2026-04-09T09:30:00Z'),
    ...overrides,
  }
}

// ── Test Cases ─────────────────────────────────────────────────────────────

describe('getApplicationState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when session does not exist (empty query result)', async () => {
    // Session query returns empty — session not found
    setupDbSelect([])

    await expect(getApplicationState(baseCtx, SESSION_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('NotFoundError has correct resourceType and resourceId', async () => {
    setupDbSelect([])

    const err = await getApplicationState(baseCtx, SESSION_ID).catch(e => e)

    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.resourceType).toBe('session')
    expect(err.resourceId).toBe(SESSION_ID)
  })

  it('throws NotFoundError when session belongs to a different user (ownership check via query filter)', async () => {
    // The ownership check is enforced via `and(eq(id, sessionId), eq(userId, ctx.userId))`.
    // If the session belongs to another user the DB returns no rows.
    // We simulate that here — the WHERE clause filters the row out.
    setupDbSelect([]) // no rows returned because userId doesn't match

    const ctxOtherUser: ServiceContext = { ...baseCtx, userId: OTHER_USER_ID }

    await expect(getApplicationState(ctxOtherUser, SESSION_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns correct ApplicationState for an owned session with all fields populated', async () => {
    const session = makeSession()
    const section = makeSection()
    setupDbSelect([session], [section])

    const state = await getApplicationState(baseCtx, SESSION_ID)

    expect(state.sessionId).toBe(SESSION_ID)
    expect(state.phase).toBe('drafting')
    expect(state.status).toBe('active')
    expect(state.selectedCallId).toBe('PNRR-C11')
    expect(state.outlineFrozen).toBe(false)
    expect(state.stateVersion).toBe(3)
    expect(state.updatedAt).toEqual(session.updatedAt)
    expect(state.eligibility).toEqual(session.eligibility)
    expect(state.blueprint).toBeNull()
    expect(state.sections).toHaveLength(1)
    expect(state.sections[0].sectionKey).toBe('context')
    expect(state.sections[0].status).toBe('accepted')
  })

  it('returns empty sections array when no sections exist', async () => {
    const session = makeSession()
    setupDbSelect([session], []) // no sections

    const state = await getApplicationState(baseCtx, SESSION_ID)

    expect(state.sections).toEqual([])
    expect(state.sessionId).toBe(SESSION_ID)
  })

  it('maps section rows to SectionListItem shape (id, sessionId, sectionKey, title, documentOrder, generationOrder, status, retryCount, updatedAt)', async () => {
    const session = makeSession()
    const section = makeSection({
      sectionKey: 'summary',
      title: 'Executive Summary',
      documentOrder: 2,
      generationOrder: 1,
      status: 'draft',
      retryCount: 1,
    })
    setupDbSelect([session], [section])

    const state = await getApplicationState(baseCtx, SESSION_ID)
    const s = state.sections[0]

    expect(s).toMatchObject({
      id: section.id,
      sessionId: SESSION_ID,
      sectionKey: 'summary',
      title: 'Executive Summary',
      documentOrder: 2,
      generationOrder: 1,
      status: 'draft',
      retryCount: 1,
    })
    expect(s.updatedAt).toEqual(section.updatedAt)
  })

  it('handles null selectedCallId correctly', async () => {
    const session = makeSession({ selectedCallId: null })
    setupDbSelect([session], [])

    const state = await getApplicationState(baseCtx, SESSION_ID)

    expect(state.selectedCallId).toBeNull()
  })

  it('handles null eligibility correctly', async () => {
    const session = makeSession({ eligibility: null })
    setupDbSelect([session], [])

    const state = await getApplicationState(baseCtx, SESSION_ID)

    expect(state.eligibility).toBeNull()
  })
})

// ── getValidationReport tests ──────────────────────────────────────────────

describe('getValidationReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when session does not exist', async () => {
    setupDbSelect([])

    await expect(getValidationReport(baseCtx, SESSION_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when session belongs to a different user', async () => {
    setupDbSelect([]) // ownership filter returns no rows

    const ctxOther: ServiceContext = { ...baseCtx, userId: OTHER_USER_ID }

    await expect(getValidationReport(ctxOther, SESSION_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns passed=false when no sections exist', async () => {
    setupDbSelect([makeSession()], [])

    const report = await getValidationReport(baseCtx, SESSION_ID)

    expect(report.passed).toBe(false)
    expect(report.summary.totalSections).toBe(0)
    expect(report.summary.acceptedSections).toBe(0)
  })

  it('returns passed=true when all sections are accepted and no eligibility blockers', async () => {
    const session = makeSession({ eligibility: { eligible: true, failCount: 0 } })
    const section1 = makeSection({ status: 'accepted' })
    const section2 = makeSection({
      id: '44444444-4444-4444-8444-444444444444',
      sectionKey: 'summary',
      status: 'accepted',
    })
    setupDbSelect([session], [section1, section2])

    const report = await getValidationReport(baseCtx, SESSION_ID)

    expect(report.passed).toBe(true)
    expect(report.summary.totalSections).toBe(2)
    expect(report.summary.acceptedSections).toBe(2)
  })

  it('returns passed=false when some sections are not accepted', async () => {
    const session = makeSession({ eligibility: { eligible: true, failCount: 0 } })
    const section1 = makeSection({ status: 'accepted' })
    const section2 = makeSection({
      id: '44444444-4444-4444-8444-444444444444',
      sectionKey: 'summary',
      status: 'draft',
    })
    setupDbSelect([session], [section1, section2])

    const report = await getValidationReport(baseCtx, SESSION_ID)

    expect(report.passed).toBe(false)
    expect(report.summary.acceptedSections).toBe(1)
    expect(report.summary.draftSections).toBe(1)
  })

  it('counts pending sections as missingSections', async () => {
    const section = makeSection({ status: 'pending' })
    setupDbSelect([makeSession()], [section])

    const report = await getValidationReport(baseCtx, SESSION_ID)

    expect(report.summary.missingSections).toBe(1)
    expect(report.summary.draftSections).toBe(0)
  })

  it('counts failed sections as missingSections', async () => {
    const section = makeSection({ status: 'failed' })
    setupDbSelect([makeSession()], [section])

    const report = await getValidationReport(baseCtx, SESSION_ID)

    expect(report.summary.missingSections).toBe(1)
  })

  it('reads eligibility blockers from session.eligibility.failCount', async () => {
    const session = makeSession({ eligibility: { eligible: false, failCount: 3 } })
    const section = makeSection({ status: 'accepted' })
    setupDbSelect([session], [section])

    const report = await getValidationReport(baseCtx, SESSION_ID)

    expect(report.passed).toBe(false)
    expect(report.summary.eligibilityBlockers).toBe(3)
  })

  it('returns 0 eligibility blockers when eligibility is null', async () => {
    const session = makeSession({ eligibility: null })
    setupDbSelect([session], [])

    const report = await getValidationReport(baseCtx, SESSION_ID)

    expect(report.summary.eligibilityBlockers).toBe(0)
  })

  it('returns issues as empty array (full rules run on rules server)', async () => {
    setupDbSelect([makeSession()], [makeSection()])

    const report = await getValidationReport(baseCtx, SESSION_ID)

    expect(report.issues).toEqual([])
  })

  it('mandatoryAnnexesMissing is always 0 in read-only report', async () => {
    setupDbSelect([makeSession()], [makeSection()])

    const report = await getValidationReport(baseCtx, SESSION_ID)

    expect(report.summary.mandatoryAnnexesMissing).toBe(0)
  })
})
