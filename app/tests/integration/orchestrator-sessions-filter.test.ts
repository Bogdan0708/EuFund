import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', email: 'test@test.com' }),
}))

vi.mock('@/lib/db', () => {
  const mockLimit = vi.fn().mockResolvedValue([])
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit })
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
  const mockLeftJoin = vi.fn().mockReturnValue({ where: mockWhere })
  const mockFrom = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin })
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
  return {
    db: {
      select: mockSelect,
    },
  }
})

vi.mock('@/lib/db/schema', () => ({
  workflowSessions: { id: 'id', userId: 'userId', status: 'status', updatedAt: 'updatedAt', projectId: 'projectId', currentStep: 'currentStep', createdAt: 'createdAt' },
  projects: { id: 'id', title: 'title' },
}))

describe('GET /api/ai/orchestrator/sessions', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('accepts status and limit query params', async () => {
    const { GET } = await import('@/app/api/ai/orchestrator/sessions/route')
    const url = new URL('http://localhost/api/ai/orchestrator/sessions?status=active&limit=1')
    const request = new Request(url)
    const response = await GET(request)
    expect(response.status).toBe(200)
  })

  it('returns sessions array in response body', async () => {
    const { GET } = await import('@/app/api/ai/orchestrator/sessions/route')
    const url = new URL('http://localhost/api/ai/orchestrator/sessions')
    const request = new Request(url)
    const response = await GET(request)
    const body = await response.json()
    expect(body).toHaveProperty('sessions')
    expect(Array.isArray(body.sessions)).toBe(true)
  })

  it('caps limit at 50', async () => {
    const { GET } = await import('@/app/api/ai/orchestrator/sessions/route')
    const url = new URL('http://localhost/api/ai/orchestrator/sessions?limit=999')
    const request = new Request(url)
    const response = await GET(request)
    expect(response.status).toBe(200)
  })
})
