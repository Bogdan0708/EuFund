import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn({
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'sess-1' }]) }) }),
  })),
}))

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id' },
}))

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: vi.fn() }))
vi.mock('@/lib/ai/agent/services/evidence', () => ({ searchCalls: vi.fn() }))
vi.mock('@/lib/projects/promotion', () => ({
  ensureProjectForSession: vi.fn().mockResolvedValue({ promoted: false, reason: 'SESSION_NOT_FOUND' }),
}))

describe('initializeSession — rawEvidence stash', () => {
  beforeEach(() => vi.clearAllMocks())

  function makeChunks(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `c${i}`, content: `chunk ${i}`, docType: 'ghid',
      source: 'src', score: 0.9 - i * 0.01, priority: 1,
    }))
  }

  const baseParams = {
    userId: '11111111-1111-4111-8111-111111111111',
    requestId: 'req-test-uuid',
    description: 'Test description for preselect',
    locale: 'ro' as const,
    selectedCallId: 'CALL-1',
    selectedScore: 0.85,
    candidates: [],
    excludeCallIdsApplied: [],
  }

  it('cache miss: stashes top-15 sliced rawEvidence and sets blueprintKind=raw_evidence', async () => {
    const { lookupBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    const chunks = makeChunks(20)
    vi.mocked(lookupBlueprint).mockResolvedValueOnce({
      cached: false, blueprint: null, rawEvidence: chunks,
    } as never)

    // Capture the inserted row's planningArtifact.
    const captured: unknown[] = []
    const { withUserRLS } = await import('@/lib/db')
    vi.mocked(withUserRLS).mockImplementationOnce((async (_uid: string, fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (v: unknown) => {
            captured.push(v)
            return { returning: () => Promise.resolve([{ id: 'sess-1' }]) }
          },
        }),
      }
      return fn(tx)
    }) as unknown as typeof withUserRLS)

    const { initializeSession } = await import('@/lib/ai/agent/services/preselect')
    const result = await initializeSession(baseParams)

    expect(result.blueprintKind).toBe('raw_evidence')
    expect(result.phase).toBe('research')

    expect(captured).toHaveLength(1)
    const row = captured[0] as { planningArtifact: { preselect: { rawEvidence?: unknown[]; blueprintKind: string } } }
    expect(row.planningArtifact.preselect.blueprintKind).toBe('raw_evidence')
    expect(row.planningArtifact.preselect.rawEvidence).toHaveLength(15)
    expect((row.planningArtifact.preselect.rawEvidence as { id: string }[])[0].id).toBe('c0')
    expect((row.planningArtifact.preselect.rawEvidence as { id: string }[])[14].id).toBe('c14')
  })

  it('cache hit: does NOT stash rawEvidence', async () => {
    const { lookupBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    vi.mocked(lookupBlueprint).mockResolvedValueOnce({
      cached: true,
      blueprint: { callId: 'CALL-1' } as never,
      rawEvidence: null,
    })

    const captured: unknown[] = []
    const { withUserRLS } = await import('@/lib/db')
    vi.mocked(withUserRLS).mockImplementationOnce((async (_uid: string, fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (v: unknown) => { captured.push(v); return { returning: () => Promise.resolve([{ id: 'sess-1' }]) } },
        }),
      }
      return fn(tx)
    }) as unknown as typeof withUserRLS)

    const { initializeSession } = await import('@/lib/ai/agent/services/preselect')
    const result = await initializeSession(baseParams)

    expect(result.blueprintKind).toBe('structured')
    expect(result.phase).toBe('structuring')

    const row = captured[0] as { planningArtifact: { preselect: { rawEvidence?: unknown[]; blueprintKind: string } } }
    expect(row.planningArtifact.preselect.blueprintKind).toBe('structured')
    expect(row.planningArtifact.preselect.rawEvidence).toBeUndefined()
  })

  it('lookupBlueprint throws: blueprintKind=none, no rawEvidence', async () => {
    const { lookupBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    vi.mocked(lookupBlueprint).mockRejectedValueOnce(new Error('Qdrant down'))

    const captured: unknown[] = []
    const { withUserRLS } = await import('@/lib/db')
    vi.mocked(withUserRLS).mockImplementationOnce((async (_uid: string, fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (v: unknown) => { captured.push(v); return { returning: () => Promise.resolve([{ id: 'sess-1' }]) } },
        }),
      }
      return fn(tx)
    }) as unknown as typeof withUserRLS)

    const { initializeSession } = await import('@/lib/ai/agent/services/preselect')
    const result = await initializeSession(baseParams)

    expect(result.blueprintKind).toBe('none')
    expect(result.phase).toBe('research')

    const row = captured[0] as { planningArtifact: { preselect: { rawEvidence?: unknown[]; blueprintKind: string } } }
    expect(row.planningArtifact.preselect.blueprintKind).toBe('none')
    expect(row.planningArtifact.preselect.rawEvidence).toBeUndefined()
  })
})
