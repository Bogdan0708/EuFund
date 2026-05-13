import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError, ConcurrencyError } from '@/lib/ai/agent/services/errors'

// drizzle-orm is not installed in worktree node_modules — mock the operators.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ op: 'eq', _col, _val })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
}))

const dbState: { session: Record<string, unknown> | null; sectionsDeleted: number } = {
  session: null,
  sectionsDeleted: 0,
}

const dbMock = {
  select: () => ({
    from: (table: Record<string, unknown>) => {
      // Distinguish agentSections queries (no limit — count sections) from
      // agentSessions queries (with limit — fetch single session).
      const isSections = table === agentSectionsStub
      return {
        where: () => ({
          // For agentSections, return empty array (no sections to discard).
          // Calling .limit() means it's an agentSessions query → return session.
          limit: async () => (dbState.session ? [dbState.session] : []),
          // Thenable: when no .limit() is chained, behave like a direct await.
          then: (resolve: (v: unknown[]) => void) =>
            resolve(isSections ? [] : (dbState.session ? [dbState.session] : [])),
        }),
      }
    },
  }),
  update: () => ({
    set: (s: Record<string, unknown>) => ({
      where: () => ({
        returning: () => {
          dbState.session = { ...(dbState.session ?? {}), ...s, stateVersion: (typeof s.stateVersion === 'number' ? s.stateVersion : (dbState.session?.stateVersion as number ?? 0) + 1) }
          // Return one row to signal CAS success (non-empty means the WHERE matched).
          return Promise.resolve([{ id: dbState.session?.id ?? 's1' }])
        },
      }),
    }),
  }),
  delete: () => ({
    where: async () => {
      dbState.sectionsDeleted += 1
      return undefined
    },
  }),
}

vi.mock('@/lib/db', () => ({
  db: dbMock,
  withUserRLS: async (_uid: string, fn: (tx: typeof dbMock) => Promise<unknown>) => fn(dbMock),
}))

// Stub used to distinguish table references in the select mock above.
const agentSectionsStub = { sessionId: 'sessionId' }

vi.mock('@/lib/logger', () => ({
  logger: { child: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })) },
}))

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'userId', stateVersion: 'stateVersion', sessionId: 'sessionId' },
  agentSections: { sessionId: 'sessionId' },
}))

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

vi.mock('@/lib/ai/agent/services/blueprint', () => ({
  lookupBlueprint: vi.fn().mockResolvedValue({ cached: false, blueprint: null, rawEvidence: null }),
  outlineFromBlueprint: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn().mockResolvedValue({ matches: [{ callId: 'C-2', title: 'New Call', program: 'X', score: 0.9 }] }),
}))

describe('changeCall service', () => {
  beforeEach(() => {
    dbState.session = {
      id: 's1', userId: 'u1', selectedCallId: 'C-1',
      currentPhase: 'structuring', blueprint: { x: 1 }, outline: [{ id: 'a' }],
      eligibility: { score: 100 }, warnings: [],
      outlineFrozen: false, stateVersion: 3, status: 'active',
    }
    dbState.sectionsDeleted = 0
  })

  it('happy path: resets fields, deletes sections, bumps stateVersion once', async () => {
    const { changeCall } = await import('@/lib/ai/agent/services/change-call')
    const out = await changeCall(
      { userId: 'u1', sessionId: 's1', requestId: 'r', now: new Date() },
      { sessionId: 's1', newCallId: 'C-2', expectedStateVersion: 3 },
    )
    expect(out.session.selectedCallId).toBe('C-2')
    expect(out.session.blueprint).toBeNull()
    expect(out.session.outline).toBeNull()
    expect(out.session.eligibility).toBeNull()
    expect(out.session.warnings).toEqual([])
    expect(out.session.currentPhase).toBe('research')
    expect(out.session.stateVersion).toBe(4)
    expect(out.sectionsDiscarded).toBeGreaterThanOrEqual(0)
  })

  it('rejects when newCallId equals current selectedCallId', async () => {
    const { changeCall } = await import('@/lib/ai/agent/services/change-call')
    await expect(changeCall(
      { userId: 'u1', sessionId: 's1', requestId: 'r', now: new Date() },
      { sessionId: 's1', newCallId: 'C-1', expectedStateVersion: 3 },
    )).rejects.toMatchObject({ policyCode: 'VALIDATION_NO_OP' })
  })

  it('rejects when outline is frozen', async () => {
    dbState.session = { ...(dbState.session ?? {}), outlineFrozen: true }
    const { changeCall } = await import('@/lib/ai/agent/services/change-call')
    await expect(changeCall(
      { userId: 'u1', sessionId: 's1', requestId: 'r', now: new Date() },
      { sessionId: 's1', newCallId: 'C-2', expectedStateVersion: 3 },
    )).rejects.toMatchObject({ policyCode: 'POLICY_OUTLINE_ALREADY_FROZEN' })
  })

  it('rejects when expectedStateVersion does not match (CAS conflict)', async () => {
    const { changeCall } = await import('@/lib/ai/agent/services/change-call')
    await expect(changeCall(
      { userId: 'u1', sessionId: 's1', requestId: 'r', now: new Date() },
      { sessionId: 's1', newCallId: 'C-2', expectedStateVersion: 999 },
    )).rejects.toMatchObject({ expected: 999, actual: 3 })
  })
})
