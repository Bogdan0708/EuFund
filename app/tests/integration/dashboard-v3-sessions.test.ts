import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'

describe('Dashboard V3 session integration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('GET /api/ai/agent/sessions returns data consumable by dashboard', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))

    const mockSessions = [
      {
        id: 'sess-1',
        projectId: 'proj-1',
        projectTitle: 'Test Project',
        status: 'active',
        currentPhase: 'drafting',
        locale: 'ro',
        selectedCallId: null,
        messageSummary: 'Working on proposal',
        stateVersion: 3,
        sectionCount: 5,
        createdAt: new Date('2026-04-09T10:00:00Z'),
        updatedAt: new Date('2026-04-09T11:00:00Z'),
      },
    ]

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(mockSessions),
                }),
              }),
            }),
          }),
        }),
      },
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/route')
    const req = new NextRequest('http://localhost/api/ai/agent/sessions?status=active&limit=1')
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)

    const session = json.data[0]
    expect(session).toHaveProperty('id')
    expect(session).toHaveProperty('currentPhase')
    expect(session).toHaveProperty('projectTitle')
    expect(session).toHaveProperty('sectionCount')
    expect(session).toHaveProperty('updatedAt')
    expect(session).toHaveProperty('status')
  })
})
