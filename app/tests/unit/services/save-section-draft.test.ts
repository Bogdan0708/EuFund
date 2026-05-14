// app/tests/unit/services/save-section-draft.test.ts
// Policy gate tests for saveSectionDraft (Phase 3a Task 9).
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id', stateVersion: 'state_version', status: 'status' },
  agentSections: { id: 'id', sessionId: 'session_id', sectionKey: 'section_key', status: 'status' },
  agentSectionVersions: { id: 'id', sectionId: 'section_id', versionNumber: 'version_number' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conditions) => ({ conditions })),
  max: vi.fn((col) => ({ fn: 'max', col })),
}))

vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

// Import AFTER mocks
import { db } from '@/lib/db'
import { saveSectionDraft } from '@/lib/ai/agent/services/sections'
import { ValidationError } from '@/lib/ai/agent/services/errors'

// ── Fixtures ───────────────────────────────────────────────────────────────

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

const OUTLINE_WITH_OBIECTIVE = [
  { id: 'obiective', title: 'Obiective', description: '', order: 1, generationOrder: 1, importance: 'standard', expectedLength: 'medium', dependsOn: [], modelHint: 'light' },
]

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    status: 'active',
    stateVersion: 0,
    selectedCallId: 'call-1',
    outlineFrozen: true,
    outline: OUTLINE_WITH_OBIECTIVE,
    eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
    updatedAt: new Date(),
    ...overrides,
  }
}

// ── Policy gate tests ──────────────────────────────────────────────────────

describe('saveSectionDraft policy gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws POLICY_OUTLINE_NOT_FROZEN when outline is not frozen', async () => {
    vi.mocked(db.select).mockImplementation(() => {
      const mockLimit = vi.fn().mockResolvedValue([makeSessionRow({ outlineFrozen: false })])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    })

    try {
      await saveSectionDraft(
        { userId: USER_ID, requestId: 'req-1', now: new Date() },
        {
          sessionId: SESSION_ID,
          sectionKey: 'obiective',
          content: 'draft content',
          expectedStateVersion: 0,
        },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
    }
  })

  it('throws POLICY_ELIGIBILITY_NOT_PASSED when eligibility failCount > 0', async () => {
    vi.mocked(db.select).mockImplementation(() => {
      const mockLimit = vi.fn().mockResolvedValue([makeSessionRow({
        outlineFrozen: true,
        eligibility: { results: [], score: 50, passCount: 2, failCount: 3, warningCount: 0 },
      })])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    })

    try {
      await saveSectionDraft(
        { userId: USER_ID, requestId: 'req-1', now: new Date() },
        {
          sessionId: SESSION_ID,
          sectionKey: 'obiective',
          content: 'draft content',
          expectedStateVersion: 0,
        },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
    }
  })

  it('throws POLICY_ELIGIBILITY_NOT_PASSED when eligibility is null (never run)', async () => {
    vi.mocked(db.select).mockImplementation(() => {
      const mockLimit = vi.fn().mockResolvedValue([makeSessionRow({
        outlineFrozen: true,
        eligibility: null,
      })])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      return { from: vi.fn().mockReturnValue({ where: mockWhere }) } as any
    })

    try {
      await saveSectionDraft(
        { userId: USER_ID, requestId: 'req-1', now: new Date() },
        {
          sessionId: SESSION_ID,
          sectionKey: 'obiective',
          content: 'draft content',
          expectedStateVersion: 0,
        },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
    }
  })
})
