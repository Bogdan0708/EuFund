import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111'
const TEST_SESSION_ID = '22222222-2222-4222-8222-222222222222'

// ─── Static mocks (hoisted) ────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: TEST_USER_ID, email: 'test@test.com' }),
}))

vi.mock('@/lib/redis/client', () => ({
  getRedis: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/db', () => {
  const mockLimit = vi.fn().mockResolvedValue([])
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
  return {
    db: { select: mockSelect },
  }
})

vi.mock('@/lib/db/schema', () => ({
  workflowSessions: { id: 'id', userId: 'userId' },
  userPreferences: { userId: 'userId', defaultModel: 'defaultModel', responseStyle: 'responseStyle', autoApprove: 'autoApprove' },
}))

vi.mock('@/lib/ai/orchestrator/engine', () => ({
  processMessage: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn().mockResolvedValue({ id: TEST_SESSION_ID }),
}))

vi.mock('@/lib/ai/orchestrator/gateway', () => ({
  createGatewayClient: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/ai/orchestrator/pubsub', () => ({
  createPubSubStream: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/ai/model-routing', () => ({
  getAIModelRoutingContext: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
  },
}))

// ─── Tests ─────────────────────────────────────────────────────

describe('Session lock fail-closed (Redis unavailable)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 503 on new session path when getRedis() returns null', async () => {
    const { POST } = await import('@/app/api/ai/orchestrator/message/route')
    const req = new NextRequest('http://localhost/api/ai/orchestrator/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    })

    const response = await POST(req)
    expect(response.status).toBe(503)

    const body = await response.json()
    expect(body.error).toBe('Service temporarily unavailable')
  })

  it('returns 503 on existing session path when getRedis() returns null', async () => {
    // Mock db.select chain to return a session (so we reach the lock check)
    const { db } = await import('@/lib/db')
    const mockLimit = vi.fn().mockResolvedValue([{ id: TEST_SESSION_ID, userId: TEST_USER_ID }])
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never)

    const { POST } = await import('@/app/api/ai/orchestrator/message/route')
    const req = new NextRequest('http://localhost/api/ai/orchestrator/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: TEST_SESSION_ID, message: 'Hello' }),
    })

    const response = await POST(req)
    expect(response.status).toBe(503)

    const body = await response.json()
    expect(body.error).toBe('Service temporarily unavailable')
  })

  it('returns 503 when Redis throws during lock acquisition', async () => {
    const { getRedis } = await import('@/lib/redis/client')
    vi.mocked(getRedis).mockReturnValue({
      set: vi.fn().mockRejectedValue(new Error('Connection refused')),
      del: vi.fn().mockResolvedValue(1),
    } as never)

    const { POST } = await import('@/app/api/ai/orchestrator/message/route')
    const req = new NextRequest('http://localhost/api/ai/orchestrator/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    })

    const response = await POST(req)
    expect(response.status).toBe(503)

    const body = await response.json()
    expect(body.error).toBe('Service temporarily unavailable')
  })
})
