import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const SECTION_ID = '33333333-3333-4333-8333-333333333333'

describe('GET /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('returns all versions with full content, newest first', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                { id: 'v3', versionNumber: 3, kind: 'regenerated', content: 'Version 3 text', modelUsed: 'claude-sonnet', sourcesUsed: [], createdAt: new Date() },
                { id: 'v2', versionNumber: 2, kind: 'draft', content: 'Version 2 text', modelUsed: 'claude-sonnet', sourcesUsed: [], createdAt: new Date() },
                { id: 'v1', versionNumber: 1, kind: 'draft', content: 'Version 1 text', modelUsed: 'claude-sonnet', sourcesUsed: [], createdAt: new Date() },
              ]),
            }),
          }),
        }),
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue({ id: SECTION_ID, sessionId: SESSION_ID }),
          },
        },
      },
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/versions`)
    const res = await GET(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(3)
    expect(json.data[0].versionNumber).toBe(3)
    expect(json.data[0].content).toBe('Version 3 text')
    expect(json.data[2].versionNumber).toBe(1)
  })

  it('returns 404 for non-existent section', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/versions`)
    const res = await GET(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(404)
  })
})
