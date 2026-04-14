// app/tests/unit/services/set-application-status.test.ts
// Focused tests for the setApplicationStatus policy gate (Task 12).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ db: { select: vi.fn(), update: vi.fn() } }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id', status: 'status', stateVersion: 'state_version' },
  agentSections: { sessionId: 'session_id', status: 'status' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conditions) => ({ conditions })),
}))

import { db } from '@/lib/db'
import { setApplicationStatus } from '@/lib/ai/agent/services/application'
import { ValidationError } from '@/lib/ai/agent/services/errors'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

const baseCtx: ServiceContext = {
  userId: USER_ID,
  requestId: 'req-policy-gate-001',
  now: new Date('2026-04-11T10:00:00Z'),
}

// Session with empty outline + no eligibility → validation passes
const baseSession = {
  id: SESSION_ID,
  userId: USER_ID,
  status: 'active',
  stateVersion: 0,
  outline: null,
  eligibility: null,
  blueprint: null,
}

// Helper: set up db.select for the paused path (1 select)
function setupPausedSelect(sessionRow: unknown) {
  vi.mocked(db.select).mockImplementation(() => {
    const mockLimit = vi.fn().mockResolvedValue([sessionRow])
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
  })
}

// Helper: set up db.select for the completed path (3 selects):
//   1. setApplicationStatus ownership check → session (with .limit)
//   2. validateApplication ownership check  → session (with .limit)
//   3. validateApplication sections query   → sectionRows (no .limit — resolves from .where)
function setupCompletedSelect(sessionRow: unknown, sectionRows: unknown[] = []) {
  let callCount = 0
  vi.mocked(db.select).mockImplementation(() => {
    callCount++
    if (callCount <= 2) {
      const mockLimit = vi.fn().mockResolvedValue([sessionRow])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    } else {
      const mockWhere = vi.fn().mockResolvedValue(sectionRows)
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

describe('setApplicationStatus policy gates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows setting status to paused from active', async () => {
    setupPausedSelect({ ...baseSession, status: 'active', stateVersion: 0 })
    setupUpdate()

    const result = await setApplicationStatus(baseCtx, {
      sessionId: SESSION_ID,
      status: 'paused',
      expectedStateVersion: 0,
    })

    expect(result.newStateVersion).toBe(1)
  })

  it('idempotent no-op: same status returns current stateVersion without mutation or policy check', async () => {
    setupPausedSelect({ ...baseSession, status: 'paused', stateVersion: 3 })

    const result = await setApplicationStatus(baseCtx, {
      sessionId: SESSION_ID,
      status: 'paused',
      expectedStateVersion: 3,
    })

    expect(result.newStateVersion).toBe(3)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('allows setting status to completed when validation passes (empty outline)', async () => {
    setupCompletedSelect({ ...baseSession, status: 'active', stateVersion: 0 })
    setupUpdate()

    const result = await setApplicationStatus(baseCtx, {
      sessionId: SESSION_ID,
      status: 'completed',
      expectedStateVersion: 0,
    })

    expect(result.newStateVersion).toBe(1)
  })

  it('throws ValidationError with POLICY_VALIDATION_NOT_PASSED when completing with missing mandatory sections', async () => {
    const sessionWithMandatory = {
      ...baseSession,
      status: 'active',
      stateVersion: 0,
      outline: [{ id: 'intro', title: 'Introduction', mandatory: true }],
      eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
    }
    // No section rows → SECTION_MISSING error → passed: false
    setupCompletedSelect(sessionWithMandatory, [])

    const err = await setApplicationStatus(baseCtx, {
      sessionId: SESSION_ID,
      status: 'completed',
      expectedStateVersion: 0,
    }).catch(e => e)

    expect(err).toBeInstanceOf(ValidationError)
    expect(err.policyCode).toBe('POLICY_VALIDATION_NOT_PASSED')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('throws POLICY_SESSION_NOT_ACTIVE when setting status on a non-active session', async () => {
    setupPausedSelect({ ...baseSession, status: 'completed', stateVersion: 0 })

    const err = await setApplicationStatus(baseCtx, {
      sessionId: SESSION_ID,
      status: 'paused',
      expectedStateVersion: 0,
    }).catch(e => e)

    expect(err).toBeInstanceOf(ValidationError)
    expect(err.policyCode).toBe('POLICY_SESSION_NOT_ACTIVE')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('does NOT throw when completing with all mandatory sections accepted', async () => {
    const sessionWithMandatory = {
      ...baseSession,
      status: 'active',
      stateVersion: 0,
      outline: [{ id: 'intro', title: 'Introduction', mandatory: true }],
      eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
    }
    const acceptedSection = {
      sessionId: SESSION_ID,
      sectionKey: 'intro',
      status: 'accepted',
      content: 'content',
      acceptedContent: 'content',
    }
    setupCompletedSelect(sessionWithMandatory, [acceptedSection])
    setupUpdate()

    const result = await setApplicationStatus(baseCtx, {
      sessionId: SESSION_ID,
      status: 'completed',
      expectedStateVersion: 0,
    })

    expect(result.newStateVersion).toBe(1)
  })
})
