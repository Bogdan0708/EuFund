import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const SECTION_ID = '33333333-3333-4333-8333-333333333333'

describe('POST /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('creates new version with rolled-back content and resets status', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))

    const insertedVersion = { id: 'v-new', versionNumber: 4, kind: 'system_rewrite', content: 'Old content from v2', modelUsed: null, sourcesUsed: null, createdAt: new Date() }

    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'active' }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue({ id: SECTION_ID, sessionId: SESSION_ID, status: 'accepted' }),
          },
        },
        transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
          let selectCallCount = 0
          const tx = {
            select: vi.fn().mockImplementation(() => {
              selectCallCount++
              if (selectCallCount === 1) {
                // First call: max version query
                return {
                  from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                      orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ versionNumber: 3 }]),
                      }),
                    }),
                  }),
                }
              }
              // Second call: target version lookup
              return {
                from: vi.fn().mockReturnValue({
                  where: vi.fn().mockResolvedValue([{ id: 'v2', versionNumber: 2, content: 'Old content from v2', modelUsed: null, sourcesUsed: null }]),
                }),
              }
            }),
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([insertedVersion]),
              }),
            }),
            update: vi.fn().mockReturnValue({
              set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
              }),
            }),
          }
          return fn(tx)
        }),
      },
    }))

    const { POST } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.kind).toBe('system_rewrite')
    expect(json.data.content).toBe('Old content from v2')
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

    const { POST } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 1 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(409)
  })

  it('returns 409 for errored session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'error' }),
          },
        },
      },
    }))

    const { POST } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 1 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(409)
  })

  it('returns 400 for malformed JSON body', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({ db: {} }))

    const { POST } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/rollback`, {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid JSON')
  })

  it('returns 400 for non-existent target version', async () => {
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
        transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
          let selectCallCount = 0
          const tx = {
            select: vi.fn().mockImplementation(() => {
              selectCallCount++
              if (selectCallCount === 1) {
                return {
                  from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                      orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ versionNumber: 3 }]),
                      }),
                    }),
                  }),
                }
              }
              return {
                from: vi.fn().mockReturnValue({
                  where: vi.fn().mockResolvedValue([]),
                }),
              }
            }),
          }
          return fn(tx)
        }),
      },
    }))

    const { POST } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 999 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Target version not found')
  })
})
