import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockLookupBlueprint, mockLogAudit, agentSessionsSymbol } = vi.hoisted(() => ({
  mockDb: { insert: vi.fn() },
  mockLookupBlueprint: vi.fn(),
  mockLogAudit: vi.fn(),
  agentSessionsSymbol: Symbol('agentSessions'),
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
  withUserRLS: (_u: string, fn: any) => fn(mockDb),
}))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: mockLookupBlueprint }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: mockLogAudit }))
vi.mock('@/lib/db/schema', () => ({
  agentSessions: agentSessionsSymbol,
}))

import { initializeSession } from '@/lib/ai/agent/services/preselect'

const CALL_ID = 'call-abc'
const USER_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  mockDb.insert.mockReset()
  mockLookupBlueprint.mockReset()
  mockLogAudit.mockReset()

  // default: insert returns a row with id
  mockDb.insert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'session-xyz' }]),
    }),
  })
})

describe('initializeSession — structured blueprint', () => {
  it('creates session with phase=structuring, blueprint populated, artifact persisted', async () => {
    const mockBlueprint = {
      callId: CALL_ID,
      requiredSections: [{ title: 'intro', description: '' }],
      confidence: 0.9,
    }
    mockLookupBlueprint.mockResolvedValue({
      cached: true,
      blueprint: mockBlueprint,
      rawEvidence: null,
    })

    const result = await initializeSession({
      userId: USER_ID,
      description: 'Primăria comunei Ocna Șugatag, proiect digitalizare muzeu',
      locale: 'ro',
      selectedCallId: CALL_ID,
      selectedScore: 0.72,
      candidates: [
        { callId: CALL_ID, title: 'Digitizare Patrimoniu', score: 0.72 },
        { callId: 'other', title: 'Other', score: 0.5 },
      ],
      excludeCallIdsApplied: [],
    })

    expect(result.sessionId).toBe('session-xyz')
    expect(result.phase).toBe('structuring')
    expect(result.blueprintKind).toBe('structured')

    const valuesCall = mockDb.insert.mock.results[0].value.values
    const inserted = valuesCall.mock.calls[0][0]
    expect(inserted.userId).toBe(USER_ID)
    expect(inserted.selectedCallId).toBe(CALL_ID)
    expect(inserted.currentPhase).toBe('structuring')
    expect(inserted.blueprint).toBe(mockBlueprint)
    expect(inserted.planningArtifact.preselect.version).toBe(1)
    expect(inserted.planningArtifact.preselect.selectedCallId).toBe(CALL_ID)
    expect(inserted.planningArtifact.preselect.selectionKind).toBe('selected')
    expect(inserted.planningArtifact.preselect.blueprintKind).toBe('structured')
    expect(inserted.planningArtifact.preselect.excludeCallIdsApplied).toEqual([])

    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'session.preselect_completed',
      userId: USER_ID,
      resourceType: 'agent_session',
      resourceId: 'session-xyz',
    }))
  })
})

describe('initializeSession — raw-evidence blueprint', () => {
  it('creates session with phase=research, blueprint null, blueprintKind=raw_evidence', async () => {
    mockLookupBlueprint.mockResolvedValue({
      cached: false,
      blueprint: null,
      rawEvidence: [
        { id: 'x', content: 'some evidence', docType: 'ghid', source: 'doc.pdf', score: 0.5 },
      ],
    })

    const result = await initializeSession({
      userId: USER_ID,
      description: 'a sufficiently long description of a project',
      locale: 'ro',
      selectedCallId: CALL_ID,
      selectedScore: 0.6,
      candidates: [{ callId: CALL_ID, title: 'X', score: 0.6 }],
      excludeCallIdsApplied: [],
    })

    expect(result.phase).toBe('research')
    expect(result.blueprintKind).toBe('raw_evidence')

    const inserted = mockDb.insert.mock.results[0].value.values.mock.calls[0][0]
    expect(inserted.currentPhase).toBe('research')
    expect(inserted.blueprint).toBeNull()
    expect(inserted.planningArtifact.preselect.blueprintKind).toBe('raw_evidence')
  })
})

describe('initializeSession — blueprint lookup failure (degraded success)', () => {
  it('creates session with phase=research, blueprintKind=none, and audit flag set', async () => {
    mockLookupBlueprint.mockRejectedValue(new Error('vector store blew up'))

    const result = await initializeSession({
      userId: USER_ID,
      description: 'a sufficiently long description of a project',
      locale: 'ro',
      selectedCallId: CALL_ID,
      selectedScore: 0.6,
      candidates: [{ callId: CALL_ID, title: 'X', score: 0.6 }],
      excludeCallIdsApplied: [],
    })

    expect(result.phase).toBe('research')
    expect(result.blueprintKind).toBe('none')

    const inserted = mockDb.insert.mock.results[0].value.values.mock.calls[0][0]
    expect(inserted.planningArtifact.preselect.blueprintKind).toBe('none')

    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'session.preselect_completed',
      metadata: expect.objectContaining({
        blueprintLookupFailed: true,
        blueprintKind: 'none',
      }),
    }))
  })
})
