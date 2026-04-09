import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

describe('GET /api/ai/agent/sessions/[sessionId]/sections', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('returns sections ordered by documentOrder', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                { id: 's1', sectionKey: 'executive-summary', title: 'Rezumat', status: 'draft', documentOrder: 0, versionCount: 2, updatedAt: new Date() },
                { id: 's2', sectionKey: 'methodology', title: 'Metodologie', status: 'accepted', documentOrder: 1, versionCount: 3, updatedAt: new Date() },
              ]),
            }),
          }),
        }),
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID }),
          },
        },
      },
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections`)
    const res = await GET(req, { params: { sessionId: SESSION_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(2)
    expect(json.data[0].sectionKey).toBe('executive-summary')
    expect(json.data[0]).toHaveProperty('versionCount')
  })

  it('returns 404 for unauthorized session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections`)
    const res = await GET(req, { params: { sessionId: SESSION_ID } })

    expect(res.status).toBe(404)
  })
})
