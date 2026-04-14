// app/tests/unit/services/application-write.test.ts
// Write operation tests for setApplicationStatus, createExportSnapshot.
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
  agentSessions: { id: 'id', userId: 'user_id', status: 'status', stateVersion: 'state_version' },
  agentSections: { sessionId: 'session_id', status: 'status' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conditions) => ({ conditions })),
}))

vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

// Import AFTER mocks
import { db } from '@/lib/db'
import { setApplicationStatus, createExportSnapshot } from '@/lib/ai/agent/services/application'
import { ConcurrencyError, NotFoundError } from '@/lib/ai/agent/services/errors'
import { logAudit } from '@/lib/legal/audit'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Fixtures ───────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const SECTION_ID = '33333333-3333-4333-8333-333333333333'

const baseCtx: ServiceContext = {
  userId: USER_ID,
  requestId: 'req-write-application-001',
  now: new Date('2026-04-09T10:00:00Z'),
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    status: 'active',
    stateVersion: 5,
    updatedAt: new Date(),
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
    content: 'Some content here',
    acceptedContent: 'Accepted content here',
    updatedAt: new Date(),
    ...overrides,
  }
}

// Helper: set up db.select for single sequence
function setupSingleSelect(rows: unknown[]) {
  vi.mocked(db.select).mockImplementation(() => {
    const mockLimit = vi.fn().mockResolvedValue(rows)
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
  })
}

function setupSelectSequence(firstRows: unknown[], secondRows: unknown[]) {
  let callCount = 0
  vi.mocked(db.select).mockImplementation(() => {
    callCount++
    const rows = callCount === 1 ? firstRows : secondRows
    const mockLimit = vi.fn().mockResolvedValue(rows)
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
  })
}

// Helper: set up db.select for the completed-status path which triggers
// validateApplication (3 selects total):
//   1. setApplicationStatus ownership check → sessionRow (with .limit)
//   2. validateApplication ownership check  → sessionRow (with .limit)
//   3. validateApplication sections query   → [] (no .limit, resolves from .where)
function setupCompletedSelect(sessionRow: unknown) {
  let callCount = 0
  vi.mocked(db.select).mockImplementation(() => {
    callCount++
    if (callCount <= 2) {
      // Selects 1 & 2: session ownership checks (both use .limit)
      const mockLimit = vi.fn().mockResolvedValue([sessionRow])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    } else {
      // Select 3: sections query in validateApplication (no .limit — resolves from .where)
      const mockWhere = vi.fn().mockResolvedValue([])
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    }
  })
}

function setupUpdate() {
  vi.mocked(db.update).mockImplementation(() => {
    const returning = vi.fn().mockResolvedValue([{ id: SESSION_ID }])
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })
    return { set } as any
  })
}

// ── setApplicationStatus tests ─────────────────────────────────────────────

describe('setApplicationStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when session does not exist', async () => {
    setupSingleSelect([])

    await expect(
      setApplicationStatus(baseCtx, { sessionId: SESSION_ID, status: 'paused', expectedStateVersion: 5 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ConcurrencyError when expectedStateVersion does not match', async () => {
    setupSingleSelect([makeSessionRow({ stateVersion: 8 })])

    await expect(
      setApplicationStatus(baseCtx, { sessionId: SESSION_ID, status: 'paused', expectedStateVersion: 5 }),
    ).rejects.toBeInstanceOf(ConcurrencyError)
  })

  it('ConcurrencyError has correct expected and actual versions', async () => {
    setupSingleSelect([makeSessionRow({ stateVersion: 8 })])

    const err = await setApplicationStatus(baseCtx, { sessionId: SESSION_ID, status: 'paused', expectedStateVersion: 5 }).catch(e => e)

    expect(err.expected).toBe(5)
    expect(err.actual).toBe(8)
  })

  it('returns current stateVersion (no-op) when status is already the target status', async () => {
    setupSingleSelect([makeSessionRow({ status: 'paused', stateVersion: 5 })])

    const result = await setApplicationStatus(baseCtx, { sessionId: SESSION_ID, status: 'paused', expectedStateVersion: 5 })

    expect(result.newStateVersion).toBe(5) // no-op: same as current
    expect(db.update).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('updates status and increments stateVersion when status differs', async () => {
    // Uses paused (not completed) to avoid triggering validateApplication
    setupSingleSelect([makeSessionRow({ status: 'active', stateVersion: 5 })])
    setupUpdate()

    const result = await setApplicationStatus(baseCtx, { sessionId: SESSION_ID, status: 'paused', expectedStateVersion: 5 })

    expect(result.newStateVersion).toBe(6)
  })

  it('emits audit log on successful status change', async () => {
    setupSingleSelect([makeSessionRow({ status: 'active', stateVersion: 5 })])
    setupUpdate()

    await setApplicationStatus(baseCtx, { sessionId: SESSION_ID, status: 'paused', expectedStateVersion: 5 })

    expect(logAudit).toHaveBeenCalledOnce()
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.status_change',
      userId: USER_ID,
      resourceId: SESSION_ID,
    }))
  })

  it('accepts paused as a valid target status', async () => {
    setupSingleSelect([makeSessionRow({ status: 'active', stateVersion: 5 })])
    setupUpdate()

    const result = await setApplicationStatus(baseCtx, { sessionId: SESSION_ID, status: 'paused', expectedStateVersion: 5 })

    expect(result.newStateVersion).toBe(6)
  })

  it('accepts completed as a valid target status when validation passes', async () => {
    // completed path triggers validateApplication (3 selects); empty outline + no
    // eligibility failures → passed: true → mutation proceeds
    setupCompletedSelect(makeSessionRow({ status: 'active', stateVersion: 5 }))
    setupUpdate()

    const result = await setApplicationStatus(baseCtx, { sessionId: SESSION_ID, status: 'completed', expectedStateVersion: 5 })

    expect(result.newStateVersion).toBe(6)
  })

  it('throws ValidationError with POLICY_VALIDATION_NOT_PASSED when completing with missing mandatory sections', async () => {
    // Session has a mandatory section in outline but no section rows → validation fails
    const sessionWithOutline = makeSessionRow({
      status: 'active',
      stateVersion: 5,
      outline: [{ id: 'intro', title: 'Introduction', mandatory: true }],
    })
    setupCompletedSelect(sessionWithOutline)

    const { ValidationError } = await import('@/lib/ai/agent/services/errors')
    const err = await setApplicationStatus(baseCtx, {
      sessionId: SESSION_ID,
      status: 'completed',
      expectedStateVersion: 5,
    }).catch(e => e)

    expect(err).toBeInstanceOf(ValidationError)
    expect(err.policyCode).toBe('POLICY_VALIDATION_NOT_PASSED')
  })
})

// ── createExportSnapshot tests ─────────────────────────────────────────────

describe('createExportSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when session does not exist', async () => {
    setupSelectSequence([], [])

    await expect(createExportSnapshot(baseCtx, SESSION_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns an ExportSnapshot with required fields', async () => {
    // First select: session check, second: accepted sections
    let callCount = 0
    vi.mocked(db.select).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Session ownership check
        const mockLimit = vi.fn().mockResolvedValue([makeSessionRow()])
        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      } else {
        // Accepted sections query (no .limit())
        const mockWhere = vi.fn().mockResolvedValue([makeSectionRow()])
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      }
    })

    const result = await createExportSnapshot(baseCtx, SESSION_ID)

    expect(result.snapshotId).toBeTruthy()
    expect(result.format).toBe('json')
    expect(result.downloadUrl).toContain(result.snapshotId)
    expect(result.expiresAt).toBeTruthy()
    // expiresAt should be 24h after ctx.now
    const expiresDate = new Date(result.expiresAt)
    const expectedExpiry = new Date(baseCtx.now.getTime() + 24 * 60 * 60 * 1000)
    expect(expiresDate.getTime()).toBe(expectedExpiry.getTime())
  })

  it('includes accepted sections in export (via audit log metadata)', async () => {
    let callCount = 0
    vi.mocked(db.select).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const mockLimit = vi.fn().mockResolvedValue([makeSessionRow()])
        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      } else {
        const mockWhere = vi.fn().mockResolvedValue([makeSectionRow(), makeSectionRow({ id: '55555555-5555-4555-8555-555555555555', sectionKey: 'summary' })])
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      }
    })

    await createExportSnapshot(baseCtx, SESSION_ID)

    expect(logAudit).toHaveBeenCalledOnce()
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.export',
      userId: USER_ID,
      resourceId: SESSION_ID,
      metadata: expect.objectContaining({ sectionCount: 2 }),
    }))
  })

  it('works when there are no accepted sections', async () => {
    let callCount = 0
    vi.mocked(db.select).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const mockLimit = vi.fn().mockResolvedValue([makeSessionRow()])
        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      } else {
        const mockWhere = vi.fn().mockResolvedValue([])
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      }
    })

    const result = await createExportSnapshot(baseCtx, SESSION_ID)

    expect(result.snapshotId).toBeTruthy()
    expect(result.format).toBe('json')
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ sectionCount: 0 }),
    }))
  })

  it('emits audit log with project.export action', async () => {
    let callCount = 0
    vi.mocked(db.select).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const mockLimit = vi.fn().mockResolvedValue([makeSessionRow()])
        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      } else {
        const mockWhere = vi.fn().mockResolvedValue([])
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      }
    })

    await createExportSnapshot(baseCtx, SESSION_ID)

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.export',
    }))
  })
})
