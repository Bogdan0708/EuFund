// Tests for services/sections.ts — validateSection
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}))

import { db } from '@/lib/db'
import { validateSection } from '@/lib/ai/agent/services/sections'
import { NotFoundError } from '@/lib/ai/agent/services/errors'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

const mockCtx = {
  userId: USER_ID,
  sessionId: SESSION_ID,
  requestId: 'req-sections-test',
  now: new Date(),
}

// The service calls db.select twice: once for ownership, once for section
// We use a call counter to return the right mock data
function mockDb(sessionExists: boolean, sectionRow: object | null) {
  let callCount = 0
  ;(db.select().from({} as any).where({} as any).limit as any).mockImplementation(() =>
    Promise.resolve(
      callCount++ === 0
        ? sessionExists ? [{ id: SESSION_ID, userId: USER_ID }] : []
        : sectionRow ? [sectionRow] : [],
    ),
  )
}

const GOOD_CONTENT = 'A'.repeat(800) // 800 chars, above medium minimum

describe('validateSection service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when session does not exist', async () => {
    mockDb(false, null)
    await expect(validateSection(mockCtx, SESSION_ID, 'context')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when section does not exist', async () => {
    mockDb(true, null)
    await expect(validateSection(mockCtx, SESSION_ID, 'nonexistent')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns error issue for empty content', async () => {
    mockDb(true, {
      id: 'sec-1',
      sessionId: SESSION_ID,
      sectionKey: 'context',
      content: '',
      acceptedContent: null,
    })
    const result = await validateSection(mockCtx, SESSION_ID, 'context')
    expect(result.issues.some(i => i.code === 'EMPTY')).toBe(true)
    expect(result.recommendedStatus).toBe('failed')
  })

  it('returns warning for content below minimum length', async () => {
    mockDb(true, {
      id: 'sec-1',
      sessionId: SESSION_ID,
      sectionKey: 'context',
      content: 'Short text.',
      acceptedContent: null,
    })
    const result = await validateSection(mockCtx, SESSION_ID, 'context')
    expect(result.issues.some(i => i.code === 'TOO_SHORT')).toBe(true)
  })

  it('detects placeholder patterns', async () => {
    mockDb(true, {
      id: 'sec-1',
      sessionId: SESSION_ID,
      sectionKey: 'context',
      content: GOOD_CONTENT + ' [TODO] something needs to be filled here',
      acceptedContent: null,
    })
    const result = await validateSection(mockCtx, SESSION_ID, 'context')
    expect(result.issues.some(i => i.code === 'PLACEHOLDER')).toBe(true)
    expect(result.recommendedStatus).toBe('failed')
  })

  it('detects repeated sentences', async () => {
    const sentence = 'This organization provides innovative solutions to Romanian businesses.'
    const repeated = (sentence + ' ').repeat(4)
    const content = GOOD_CONTENT + ' ' + repeated
    mockDb(true, {
      id: 'sec-1',
      sessionId: SESSION_ID,
      sectionKey: 'context',
      content,
      acceptedContent: null,
    })
    const result = await validateSection(mockCtx, SESSION_ID, 'context')
    expect(result.issues.some(i => i.code === 'REPETITION')).toBe(true)
  })

  it('returns no issues and needs_review for good content', async () => {
    mockDb(true, {
      id: 'sec-1',
      sessionId: SESSION_ID,
      sectionKey: 'context',
      content: GOOD_CONTENT,
      acceptedContent: null,
    })
    const result = await validateSection(mockCtx, SESSION_ID, 'context')
    expect(result.issues).toHaveLength(0)
    expect(result.score).toBe(100)
    expect(result.recommendedStatus).toBe('needs_review')
    expect(result.sectionKey).toBe('context')
  })

  it('score decreases with each error/warning', async () => {
    mockDb(true, {
      id: 'sec-1',
      sessionId: SESSION_ID,
      sectionKey: 'context',
      content: 'Too short.',
      acceptedContent: null,
    })
    const result = await validateSection(mockCtx, SESSION_ID, 'context')
    expect(result.score).toBeLessThan(100)
  })
})
