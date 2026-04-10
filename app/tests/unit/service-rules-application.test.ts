// Tests for services/application.ts — validateApplication and checkMissingAnnexes
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.doMock with per-test setup to avoid stale mock state
vi.mock('@/lib/db', () => {
  const mockDb = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  }
  // Chain: select → from → where → [limit | await]
  mockDb.select.mockReturnThis()
  mockDb.from.mockReturnThis()
  mockDb.where.mockReturnThis()
  mockDb.limit.mockResolvedValue([])
  return { db: mockDb }
})

import { db as _db } from '@/lib/db'
import { validateApplication, checkMissingAnnexes } from '@/lib/ai/agent/services/application'
import { NotFoundError } from '@/lib/ai/agent/services/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = _db as any

const SESSION_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'

const mockCtx = {
  userId: USER_ID,
  sessionId: SESSION_ID,
  requestId: 'req-app-test',
  now: new Date(),
}

/**
 * Sets up the DB mock for services that call:
 *   1. db.select().from().where().limit(1)  → session lookup
 *   2. db.select().from().where()            → sections load (no limit)
 *
 * The trick: `.where()` returns an object that is both thenable (for direct await)
 * and has a `.limit()` method. We swap behaviour on each call.
 */
function setupDbMocks(sessionRow: object | null, sectionRows: object[]) {
  let callIndex = 0

  ;(db.where as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const thisCall = callIndex++
    if (thisCall === 0) {
      // First call: session lookup — caller chains .limit(1)
      const chain: any = {
        limit: vi.fn().mockResolvedValue(sessionRow ? [sessionRow] : []),
      }
      // Also make it thenable so a bare await works (returns [] for safety)
      chain.then = (resolve: any) => resolve([])
      return chain
    } else {
      // Second call: sections load — caller awaits directly (no .limit)
      const thenable: any = {
        limit: vi.fn().mockResolvedValue(sectionRows),
        then: (resolve: any, reject?: any) => Promise.resolve(sectionRows).then(resolve, reject),
        catch: (reject: any) => Promise.resolve(sectionRows).catch(reject),
        finally: (fn: any) => Promise.resolve(sectionRows).finally(fn),
      }
      return thenable
    }
  })
}

const acceptedSection = (key: string, content = 'This section content mentions Anexa 1 - Buget details.') => ({
  id: `sec-${key}`,
  sessionId: SESSION_ID,
  sectionKey: key,
  status: 'accepted',
  content,
  acceptedContent: content,
})

const draftSection = (key: string) => ({
  id: `sec-${key}`,
  sessionId: SESSION_ID,
  sectionKey: key,
  status: 'draft',
  content: 'Some content here.',
  acceptedContent: null,
})

const sessionWithOutline = (outline: object[], blueprint: object | null = null, eligibility: object | null = null) => ({
  id: SESSION_ID,
  userId: USER_ID,
  outline,
  blueprint,
  eligibility,
})

// ── validateApplication ──────────────────────────────────────────────────────

describe('validateApplication service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(db.select as ReturnType<typeof vi.fn>).mockReturnThis()
    ;(db.from as ReturnType<typeof vi.fn>).mockReturnThis()
  })

  it('throws NotFoundError when session does not exist', async () => {
    setupDbMocks(null, [])
    await expect(validateApplication(mockCtx, SESSION_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('passes when all mandatory sections accepted and no eligibility blockers', async () => {
    setupDbMocks(
      sessionWithOutline(
        [{ id: 'context', title: 'Context', mandatory: true }],
        null,
        { failCount: 0, warningCount: 0, passCount: 3 },
      ),
      [acceptedSection('context')],
    )
    const result = await validateApplication(mockCtx, SESSION_ID)
    expect(result.passed).toBe(true)
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('reports SECTION_MISSING blocker for ungenerated mandatory sections', async () => {
    setupDbMocks(
      sessionWithOutline([
        { id: 'context', title: 'Context', mandatory: true },
        { id: 'budget', title: 'Budget', mandatory: true },
      ]),
      [acceptedSection('context')],
    )
    const result = await validateApplication(mockCtx, SESSION_ID)
    const missingIssue = result.issues.find(i => i.code === 'SECTION_MISSING')
    expect(missingIssue).toBeDefined()
    expect(missingIssue?.sectionKey).toBe('budget')
    expect(result.passed).toBe(false)
  })

  it('reports SECTION_NOT_ACCEPTED warning for draft sections', async () => {
    setupDbMocks(
      sessionWithOutline([{ id: 'context', title: 'Context', mandatory: true }]),
      [draftSection('context')],
    )
    const result = await validateApplication(mockCtx, SESSION_ID)
    expect(result.issues.some(i => i.code === 'SECTION_NOT_ACCEPTED')).toBe(true)
  })

  it('reports ELIGIBILITY_FAIL blocker when eligibility has failures', async () => {
    setupDbMocks(
      sessionWithOutline([], null, { failCount: 2, warningCount: 0, passCount: 3 }),
      [],
    )
    const result = await validateApplication(mockCtx, SESSION_ID)
    expect(result.issues.some(i => i.code === 'ELIGIBILITY_FAIL')).toBe(true)
    expect(result.summary.eligibilityBlockers).toBe(2)
    expect(result.passed).toBe(false)
  })

  it('reports ELIGIBILITY_NOT_RUN warning when eligibility is null', async () => {
    setupDbMocks(sessionWithOutline([]), [])
    const result = await validateApplication(mockCtx, SESSION_ID)
    expect(result.issues.some(i => i.code === 'ELIGIBILITY_NOT_RUN')).toBe(true)
  })

  it('reports ANNEX_MISSING warning for unreferenced mandatory annexes', async () => {
    setupDbMocks(
      sessionWithOutline(
        [],
        { mandatoryAnnexes: ['Anexa 2 - CV'] },
        { failCount: 0, warningCount: 0, passCount: 3 },
      ),
      [acceptedSection('context', 'Some content without that annex')],
    )
    const result = await validateApplication(mockCtx, SESSION_ID)
    expect(result.issues.some(i => i.code === 'ANNEX_MISSING')).toBe(true)
    expect(result.summary.mandatoryAnnexesMissing).toBe(1)
  })

  it('reports STALE_DATA warning when freshness confidence is low', async () => {
    setupDbMocks(
      sessionWithOutline([], { mandatoryAnnexes: [], freshnessConfidence: 0.4 }),
      [],
    )
    const result = await validateApplication(mockCtx, SESSION_ID)
    expect(result.issues.some(i => i.code === 'STALE_DATA')).toBe(true)
  })

  it('returns accurate summary counts', async () => {
    setupDbMocks(
      sessionWithOutline(
        [
          { id: 'context', title: 'Context', mandatory: true },
          { id: 'budget', title: 'Budget', mandatory: true },
          { id: 'team', title: 'Team', mandatory: true },
        ],
        null,
        { failCount: 0, warningCount: 0, passCount: 3 },
      ),
      [acceptedSection('context'), acceptedSection('budget'), draftSection('team')],
    )
    const result = await validateApplication(mockCtx, SESSION_ID)
    expect(result.summary.totalSections).toBe(3)
    expect(result.summary.acceptedSections).toBe(2)
    expect(result.summary.draftSections).toBe(1)
  })
})

// ── checkMissingAnnexes ──────────────────────────────────────────────────────

describe('checkMissingAnnexes service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(db.select as ReturnType<typeof vi.fn>).mockReturnThis()
    ;(db.from as ReturnType<typeof vi.fn>).mockReturnThis()
  })

  it('throws NotFoundError when session does not exist', async () => {
    // checkMissingAnnexes only calls db.select once (with .limit), so simple mock
    ;(db.where as ReturnType<typeof vi.fn>).mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
    await expect(checkMissingAnnexes(mockCtx, SESSION_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns empty lists when blueprint has no annexes', async () => {
    // Blueprint null — only one DB call (session)
    ;(db.where as ReturnType<typeof vi.fn>).mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ id: SESSION_ID, userId: USER_ID, blueprint: null }]),
    })
    const result = await checkMissingAnnexes(mockCtx, SESSION_ID)
    expect(result.required).toHaveLength(0)
    expect(result.uploaded).toHaveLength(0)
    expect(result.missing).toHaveLength(0)
  })

  it('separates mentioned and missing annexes correctly', async () => {
    setupDbMocks(
      { id: SESSION_ID, userId: USER_ID, blueprint: { mandatoryAnnexes: ['Anexa 1 - Buget', 'Anexa 2 - CV'] } },
      [
        acceptedSection('context', 'This references Anexa 1 - Buget for the financial plan.'),
        acceptedSection('team', 'Team section does not mention either annex.'),
      ],
    )
    const result = await checkMissingAnnexes(mockCtx, SESSION_ID)
    expect(result.required).toEqual(['Anexa 1 - Buget', 'Anexa 2 - CV'])
    expect(result.uploaded).toContain('Anexa 1 - Buget')
    expect(result.missing).toContain('Anexa 2 - CV')
  })

  it('marks all annexes as uploaded when all are mentioned', async () => {
    const content = 'This references Anexa 1 - Buget and also Anexa 2 - CV throughout.'
    setupDbMocks(
      { id: SESSION_ID, userId: USER_ID, blueprint: { mandatoryAnnexes: ['Anexa 1 - Buget', 'Anexa 2 - CV'] } },
      [acceptedSection('context', content)],
    )
    const result = await checkMissingAnnexes(mockCtx, SESSION_ID)
    expect(result.missing).toHaveLength(0)
    expect(result.uploaded).toHaveLength(2)
  })
})
