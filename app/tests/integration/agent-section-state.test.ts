import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const SECTION_ID = '33333333-3333-4333-8333-333333333333'

describe('PATCH /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('allows valid transition draft → accepted', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'active' }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue({ id: SECTION_ID, sessionId: SESSION_ID, status: 'draft' }),
          },
        },
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { id: SECTION_ID, sectionKey: 'summary', title: 'Summary', status: 'accepted', documentOrder: 0, updatedAt: new Date() },
              ]),
            }),
          }),
        }),
      },
    }))

    const { PATCH } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.status).toBe('accepted')
  })

  it('rejects invalid transition pending → accepted', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'active' }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue({ id: SECTION_ID, sessionId: SESSION_ID, status: 'pending' }),
          },
        },
      },
    }))

    const { PATCH } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(400)
  })

  it('returns 409 for completed session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'completed' }),
          },
        },
      },
    }))

    const { PATCH } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(409)
  })
})
