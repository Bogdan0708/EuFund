// app/tests/unit/services/sections-write.test.ts
// Write operation tests for saveSectionDraft, approveSection, rollbackSection.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted — do NOT reference outer const vars inside them.

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: vi.fn() as any,
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id', stateVersion: 'state_version', status: 'status' },
  agentSections: { id: 'id', sessionId: 'session_id', sectionKey: 'section_key', status: 'status' },
  agentSectionVersions: { id: 'id', sectionId: 'section_id', versionNumber: 'version_number' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conditions) => ({ conditions })),
  max: vi.fn((col) => ({ fn: 'max', col })),
}))

vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

// Import AFTER mocks
import { db } from '@/lib/db'
import { saveSectionDraft, approveSection, rollbackSection } from '@/lib/ai/agent/services/sections'
import { ConcurrencyError, NotFoundError } from '@/lib/ai/agent/services/errors'
import { logAudit } from '@/lib/legal/audit'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Fixtures ───────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const SECTION_ID = '33333333-3333-4333-8333-333333333333'
const VERSION_ID = '44444444-4444-4444-8444-444444444444'

const baseCtx: ServiceContext = {
  userId: USER_ID,
  requestId: 'req-write-sections-001',
  now: new Date('2026-04-09T10:00:00Z'),
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    status: 'active',
    stateVersion: 5,
    selectedCallId: 'call-1',
    outlineFrozen: true,
    eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
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
    status: 'draft',
    content: 'Some content here',
    acceptedContent: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    sectionId: SECTION_ID,
    versionNumber: 2,
    kind: 'draft',
    content: 'Old version content',
    createdAt: new Date(),
    ...overrides,
  }
}

// ── saveSectionDraft tests ─────────────────────────────────────────────────

describe('saveSectionDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when session does not exist', async () => {
    // verifySessionOwnership returns []
    vi.mocked(db.select).mockImplementation(() => {
      const mockLimit = vi.fn().mockResolvedValue([])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    })

    await expect(
      saveSectionDraft(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', content: 'text', expectedStateVersion: 5 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ConcurrencyError when expectedStateVersion does not match', async () => {
    vi.mocked(db.select).mockImplementation(() => {
      const mockLimit = vi.fn().mockResolvedValue([makeSessionRow({ stateVersion: 7 })])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    })

    await expect(
      saveSectionDraft(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', content: 'text', expectedStateVersion: 5 }),
    ).rejects.toBeInstanceOf(ConcurrencyError)
  })

  it('ConcurrencyError has correct expected and actual versions', async () => {
    vi.mocked(db.select).mockImplementation(() => {
      const mockLimit = vi.fn().mockResolvedValue([makeSessionRow({ stateVersion: 7 })])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    })

    const err = await saveSectionDraft(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', content: 'text', expectedStateVersion: 5 }).catch(e => e)

    expect(err.expected).toBe(5)
    expect(err.actual).toBe(7)
  })

  it('creates section and returns correct versionNumber and newStateVersion on success', async () => {
    // verifySessionOwnership call
    vi.mocked(db.select).mockImplementation(() => {
      const mockLimit = vi.fn().mockResolvedValue([makeSessionRow({ stateVersion: 5 })])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    })

    // transaction mock: simulates the full tx body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db.transaction as any).mockImplementation(async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
      }

      // tx.select: 1st call = existing section check (returns []), 2nd call = max version (returns [{maxVersion: 0}])
      let txSelectCount = 0
      tx.select.mockImplementation(() => {
        txSelectCount++
        if (txSelectCount === 1) {
          // existing section check — not found
          const mockLimit = vi.fn().mockResolvedValue([])
          const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
          return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
        } else {
          // max version query
          const mockWhere = vi.fn().mockResolvedValue([{ maxVersion: 0 }])
          return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
        }
      })

      // tx.insert: returns sectionId for section insert, undefined for version insert
      let txInsertCount = 0
      tx.insert.mockImplementation(() => {
        txInsertCount++
        if (txInsertCount === 1) {
          // section insert
          const returning = vi.fn().mockResolvedValue([{ id: SECTION_ID }])
          const values = vi.fn().mockReturnValue({ returning })
          return { values } as any
        } else {
          // version insert
          const values = vi.fn().mockResolvedValue([])
          return { values } as any
        }
      })

      // tx.update: session stateVersion increment (CAS returns affected row)
      tx.update.mockImplementation(() => {
        const returning = vi.fn().mockResolvedValue([{ id: SESSION_ID }])
        const where = vi.fn().mockReturnValue({ returning })
        const set = vi.fn().mockReturnValue({ where })
        return { set } as any
      })

      await fn(tx)
    })

    const result = await saveSectionDraft(baseCtx, {
      sessionId: SESSION_ID,
      sectionKey: 'context',
      content: 'Hello world',
      expectedStateVersion: 5,
    })

    expect(result.sectionId).toBe(SECTION_ID)
    expect(result.versionNumber).toBe(1)
    expect(result.newStateVersion).toBe(6)
  })

  it('emits audit log on success', async () => {
    vi.mocked(db.select).mockImplementation(() => {
      const mockLimit = vi.fn().mockResolvedValue([makeSessionRow({ stateVersion: 5 })])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db.transaction as any).mockImplementation(async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
      }
      let txSelectCount = 0
      tx.select.mockImplementation(() => {
        txSelectCount++
        if (txSelectCount === 1) {
          const mockLimit = vi.fn().mockResolvedValue([makeSectionRow()])
          const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
          return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
        } else {
          const mockWhere = vi.fn().mockResolvedValue([{ maxVersion: 2 }])
          return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
        }
      })
      tx.update.mockImplementation(() => {
        const returning = vi.fn().mockResolvedValue([{ id: SESSION_ID }])
        const where = vi.fn().mockReturnValue({ returning })
        const set = vi.fn().mockReturnValue({ where })
        return { set } as any
      })
      tx.insert.mockImplementation(() => {
        const values = vi.fn().mockResolvedValue([])
        return { values } as any
      })
      await fn(tx)
    })

    await saveSectionDraft(baseCtx, {
      sessionId: SESSION_ID,
      sectionKey: 'context',
      content: 'Hello',
      expectedStateVersion: 5,
    })

    expect(logAudit).toHaveBeenCalledOnce()
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      action: 'project.version_save',
    }))
  })
})

// ── approveSection tests ───────────────────────────────────────────────────

describe('approveSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupSelectSequence(sessionRow: unknown, sectionRows: unknown[]) {
    let callCount = 0
    vi.mocked(db.select).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const mockLimit = vi.fn().mockResolvedValue([sessionRow])
        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      } else {
        const mockLimit = vi.fn().mockResolvedValue(sectionRows)
        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      }
    })
  }

  function setupTransaction() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db.transaction as any).mockImplementation(async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        update: vi.fn().mockImplementation(() => {
          const returning = vi.fn().mockResolvedValue([{ id: SESSION_ID }])
          const where = vi.fn().mockReturnValue({ returning })
          const set = vi.fn().mockReturnValue({ where })
          return { set } as any
        }),
      }
      await fn(tx)
    })
  }

  it('throws ConcurrencyError when expectedStateVersion does not match', async () => {
    setupSelectSequence(makeSessionRow({ stateVersion: 3 }), [makeSectionRow()])

    await expect(
      approveSection(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', expectedStateVersion: 5 }),
    ).rejects.toBeInstanceOf(ConcurrencyError)
  })

  it('throws NotFoundError when section does not exist', async () => {
    setupSelectSequence(makeSessionRow(), [])

    await expect(
      approveSection(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', expectedStateVersion: 5 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns current stateVersion (no-op) when section is already accepted', async () => {
    setupSelectSequence(makeSessionRow({ stateVersion: 5 }), [makeSectionRow({ status: 'accepted' })])

    const result = await approveSection(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', expectedStateVersion: 5 })

    expect(result.newStateVersion).toBe(5) // no-op: same as current
    expect(db.transaction).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('sets status to accepted and increments stateVersion when section is in draft', async () => {
    setupSelectSequence(makeSessionRow({ stateVersion: 5 }), [makeSectionRow({ status: 'draft' })])
    setupTransaction()

    const result = await approveSection(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', expectedStateVersion: 5 })

    expect(result.newStateVersion).toBe(6)
  })

  it('emits audit log on successful approval', async () => {
    setupSelectSequence(makeSessionRow({ stateVersion: 5 }), [makeSectionRow({ status: 'draft' })])
    setupTransaction()

    await approveSection(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', expectedStateVersion: 5 })

    expect(logAudit).toHaveBeenCalledOnce()
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'section.state_change',
      userId: USER_ID,
    }))
  })
})

// ── rollbackSection tests ──────────────────────────────────────────────────

describe('rollbackSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupSelectSequence(sessionRow: unknown, sectionRows: unknown[], versionRows: unknown[]) {
    let callCount = 0
    vi.mocked(db.select).mockImplementation(() => {
      callCount++
      // call 1 = session ownership check
      // call 2 = section lookup
      // call 3 = target version lookup
      // call 4 = max version query (added when version insert was introduced)
      let data: unknown[]
      if (callCount === 1) {
        data = [sessionRow]
      } else if (callCount === 2) {
        data = sectionRows
      } else if (callCount === 3) {
        data = versionRows
      } else {
        // maxVersion query — returns a row without limit() chain
        const mockWhere = vi.fn().mockResolvedValue([{ maxVersion: 2 }])
        return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
      }
      const mockLimit = vi.fn().mockResolvedValue(data)
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    })
  }

  function setupTransaction() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db.transaction as any).mockImplementation(async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        update: vi.fn().mockImplementation(() => {
          const returning = vi.fn().mockResolvedValue([{ id: SESSION_ID }])
          const where = vi.fn().mockReturnValue({ returning })
          const set = vi.fn().mockReturnValue({ where })
          return { set } as any
        }),
        insert: vi.fn().mockImplementation(() => {
          const values = vi.fn().mockResolvedValue([])
          return { values } as any
        }),
      }
      await fn(tx)
    })
  }

  it('throws ConcurrencyError when expectedStateVersion does not match', async () => {
    setupSelectSequence(makeSessionRow({ stateVersion: 9 }), [makeSectionRow()], [makeVersionRow()])

    await expect(
      rollbackSection(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', targetVersion: 2, expectedStateVersion: 5 }),
    ).rejects.toBeInstanceOf(ConcurrencyError)
  })

  it('throws NotFoundError when section does not exist', async () => {
    setupSelectSequence(makeSessionRow(), [], [])

    await expect(
      rollbackSection(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', targetVersion: 2, expectedStateVersion: 5 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when target version does not exist', async () => {
    setupSelectSequence(makeSessionRow(), [makeSectionRow()], [])

    await expect(
      rollbackSection(baseCtx, { sessionId: SESSION_ID, sectionKey: 'context', targetVersion: 99, expectedStateVersion: 5 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('restores content from the target version and returns correct result', async () => {
    setupSelectSequence(makeSessionRow({ stateVersion: 5 }), [makeSectionRow()], [makeVersionRow({ content: 'Old version content', versionNumber: 2 })])
    setupTransaction()

    const result = await rollbackSection(baseCtx, {
      sessionId: SESSION_ID,
      sectionKey: 'context',
      targetVersion: 2,
      expectedStateVersion: 5,
    })

    expect(result.content).toBe('Old version content')
    expect(result.restoredVersion).toBe(2)
    expect(result.newStateVersion).toBe(6)
  })

  it('emits audit log on success', async () => {
    setupSelectSequence(makeSessionRow({ stateVersion: 5 }), [makeSectionRow()], [makeVersionRow()])
    setupTransaction()

    await rollbackSection(baseCtx, {
      sessionId: SESSION_ID,
      sectionKey: 'context',
      targetVersion: 2,
      expectedStateVersion: 5,
    })

    expect(logAudit).toHaveBeenCalledOnce()
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'section.rollback',
      userId: USER_ID,
    }))
  })
})
