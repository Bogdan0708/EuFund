import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, auditMock, dbMock, updateChain } = vi.hoisted(() => {
  const updateChain = {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'sess-1' }]),
      })),
    })),
  };
  return {
    ensureMock: vi.fn(),
    auditMock: vi.fn().mockResolvedValue(undefined),
    updateChain,
    dbMock: {
      update: vi.fn(() => updateChain),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ stateVersion: 3 }]),
          })),
        })),
      })),
    },
  };
});

vi.mock('@/lib/projects/promotion', () => ({ ensureProjectForSession: ensureMock }));
vi.mock('@/lib/legal/audit', () => ({ logAudit: auditMock }));
vi.mock('@/lib/db', () => ({ db: dbMock, withUserRLS: vi.fn() }));
vi.mock('@/lib/db/schema', () => ({ agentSessions: { id: 'sess.id', stateVersion: 'sess.state_version' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }));

vi.mock('@/lib/ai/agent/policy/matrix', () => ({
  POLICY_MATRIX: {
    setSelectedCall: { auditAction: 'session.call_selected', code: 'POLICY_OUTLINE_ALREADY_FROZEN' },
  },
  assertPolicy: vi.fn(),
}));

// verifySessionOwnership lives in context-helpers and is imported by
// application.ts; mock it at its source module so the import resolves to
// our stub rather than the real DB-touching implementation.
const { verifyOwnershipMock } = vi.hoisted(() => ({
  verifyOwnershipMock: vi.fn(),
}));

vi.mock('@/lib/ai/agent/services/context-helpers', () => ({
  verifySessionOwnership: verifyOwnershipMock,
}));

import * as appSvc from '@/lib/ai/agent/services/application';

const ctx = { userId: 'user-1', sessionId: 'sess-1', requestId: 'req-1', now: new Date() } as any;

function makeSession(overrides: Partial<{
  selectedCallId: string | null;
  projectId: string | null;
  stateVersion: number;
  outlineFrozen: boolean;
}> = {}) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    selectedCallId: 'OLD-CALL',
    projectId: null,
    stateVersion: 3,
    outlineFrozen: false,
    ...overrides,
  };
}

describe('setSelectedCall — promotion integration', () => {
  beforeEach(() => {
    ensureMock.mockReset();
    auditMock.mockReset();
    verifyOwnershipMock.mockReset();
    dbMock.update.mockReset();
    dbMock.update.mockReturnValue(updateChain);
    dbMock.select.mockReset();
    dbMock.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ stateVersion: 3 }]),
        })),
      })),
    });
  });

  it('same callId + linked → no-op return with existing projectId', async () => {
    verifyOwnershipMock.mockResolvedValueOnce(makeSession({
      selectedCallId: 'CALL-X',
      projectId: 'proj-existing',
      stateVersion: 3,
    }));
    const out = await appSvc.setSelectedCall(ctx, { sessionId: 'sess-1', callId: 'CALL-X', expectedStateVersion: 3 });
    expect(out).toEqual({ newStateVersion: 3, projectId: 'proj-existing' });
    expect(ensureMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('same callId + unlinked → skip CAS/audit, run promotion, return existing stateVersion', async () => {
    verifyOwnershipMock.mockResolvedValueOnce(makeSession({
      selectedCallId: 'CALL-X',
      projectId: null,
      stateVersion: 3,
    }));
    ensureMock.mockResolvedValueOnce({ promoted: true, projectId: 'proj-new', created: true, titleSource: 'description', selectedCallResolution: 'callCode' });
    const out = await appSvc.setSelectedCall(ctx, { sessionId: 'sess-1', callId: 'CALL-X', expectedStateVersion: 3 });
    expect(out).toEqual({ newStateVersion: 3, projectId: 'proj-new' });
    expect(auditMock).not.toHaveBeenCalled();
    expect(ensureMock).toHaveBeenCalledOnce();
  });

  it('different callId → CAS+audit then promotion, returns new stateVersion', async () => {
    verifyOwnershipMock.mockResolvedValueOnce(makeSession({
      selectedCallId: 'OLD-CALL',
      projectId: null,
      stateVersion: 3,
    }));
    ensureMock.mockResolvedValueOnce({ promoted: true, projectId: 'proj-new', created: true, titleSource: 'fallback', selectedCallResolution: 'unresolved' });
    const out = await appSvc.setSelectedCall(ctx, { sessionId: 'sess-1', callId: 'NEW-CALL', expectedStateVersion: 3 });
    expect(out).toEqual({ newStateVersion: 4, projectId: 'proj-new' });
    expect(auditMock).toHaveBeenCalledOnce();
    expect(ensureMock).toHaveBeenCalledOnce();
  });
});
