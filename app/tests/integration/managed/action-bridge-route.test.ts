import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/ai/agent/route'
import { NextRequest } from 'next/server'
import { bridgeStructuredAction } from '@/lib/ai/agent/managed/bridge'
import { isFeatureEnabled } from '@/lib/feature-flags'

vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: vi.fn((_key, handler) => handler),
}))

const mockRunManaged = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(),
}))

vi.mock('@/lib/ai/agent/managed/runtime', () => ({
  runManagedTurn: mockRunManaged,
}))

vi.mock('@/lib/ai/agent/managed/bridge', () => ({
  bridgeStructuredAction: vi.fn(),
}))

vi.mock('@/lib/ai/agent/managed/circuit-breaker', () => ({
  managedCircuitBreaker: { isOpen: () => false },
  recordManagedFailure: vi.fn(),
  recordManagedSuccess: vi.fn(),
}))

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: vi.fn(() => ({ messages: {} })),
}))

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}))

vi.mock('@/lib/db', () => {
  const row = {
    id: 'sess-1',
    userId: 'user-1',
    projectId: null,
    stateVersion: 1,
    status: 'active',
    locale: 'ro',
    selectedCallId: 'CALL-A',
    currentPhase: 'structuring',
    outlineFrozen: false,
    messageSummary: null,
  }

  const makeChain = (result: any) => {
    const chain: any = {
      limit: vi.fn().mockResolvedValue(result),
      then: vi.fn((cb) => Promise.resolve(result).then(cb)),
      catch: vi.fn(() => chain),
    }
    return chain
  }

  return {
    db: {
      transaction: vi.fn(async (fn) => fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ userId: 'user-1' }]),
            })),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: 'turn-1' }]),
          })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn((table: any) => ({
          where: vi.fn((pred: any) => {
            if (String(table).includes('agent_sections') || (table as any)._name === 'agent_sections') {
              return makeChain([])
            }
            return makeChain([row])
          }),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'new-row' }]),
          onConflictDoNothing: vi.fn().mockResolvedValue({}),
        })),
      })),
    },
  }
})

describe('Managed Action Bridge — Route Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    ;(isFeatureEnabled as any).mockImplementation(async (key: string) => {
      if (key === 'agent_v3_enabled') return true
      if (key === 'managed_agent_enabled') return true
      if (key === 'managed_agent_writes_enabled') return true
      return false
    })
  })

  it('routes structured action to bridge when managed is enabled', async () => {
    ;(bridgeStructuredAction as any).mockResolvedValue({
      outcome: 'success',
      stateVersionBumped: true,
      continueToManaged: false,
    })

    const body = {
      sessionId: 'sess-1',
      requestId: 'req-1',
      locale: 'ro',
      action: { type: 'approve_outline' },
    }

    const req = new NextRequest('http://localhost/api/ai/agent', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const res = await POST(req)
    await res.text()

    expect(bridgeStructuredAction).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', userId: 'user-1' }),
      body.action,
      expect.any(Number)
    )
    
    expect(mockRunManaged).not.toHaveBeenCalled()
  })

  it('returns SSE error when bridge fails', async () => {
    ;(bridgeStructuredAction as any).mockResolvedValue({
      outcome: 'policy_error',
      errorCode: 'POLICY_OUTLINE_NOT_FROZEN',
      errorMessage: 'POLICY_OUTLINE_NOT_FROZEN',
      stateVersionBumped: false,
      continueToManaged: false,
    })

    const body = {
      sessionId: 'sess-1',
      requestId: 'req-1',
      locale: 'ro',
      action: { type: 'accept_section', sectionKey: 'intro' },
    }

    const req = new NextRequest('http://localhost/api/ai/agent', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const res = await POST(req)
    const text = await res.text()

    expect(text).toContain('Acțiunea nu poate fi aplicată')
    expect(text).toContain('"code":"POLICY_OUTLINE_NOT_FROZEN"')
    expect(text).not.toContain('POLICY_OUTLINE_NOT_FROZEN:')
    expect(mockRunManaged).not.toHaveBeenCalled()
  })

  it('returns SSE error when writes are disabled for the account', async () => {
    ;(isFeatureEnabled as any).mockImplementation(async (key: string) => {
      if (key === 'managed_agent_writes_enabled') return false
      return true
    })

    const body = {
      sessionId: 'sess-1',
      requestId: 'req-1',
      locale: 'ro',
      action: { type: 'approve_outline' },
    }

    const req = new NextRequest('http://localhost/api/ai/agent', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const res = await POST(req)
    const text = await res.text()

    expect(text).toContain('Scrierile gestionate nu sunt activate')
    expect(text).toContain('"code":"MANAGED_WRITES_DISABLED"')
    expect(bridgeStructuredAction).not.toHaveBeenCalled()
  })
})
