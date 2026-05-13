// ── saveSectionDraft policy gate: sectionKey not in outline ──────────────
// Verifies that saveSectionDraft throws POLICY_SECTION_NOT_IN_OUTLINE when
// the requested sectionKey is not present in the session outline, even when
// every other precondition is satisfied: status=active, outlineFrozen=true,
// outline is non-empty, stateVersion matches.
//
// Hermetic: no real DB. verifySessionOwnership is mocked to return a
// controlled fixture; the policy gate throws before any DB mutation fires.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock stubs needed by the sections.ts module graph ────────────────────

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))
vi.mock('@/lib/db', () => {
  const chain: any = {
    update: vi.fn(() => chain),
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    returning: vi.fn().mockResolvedValue([]),
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    limit: vi.fn().mockResolvedValue([]),
  }
  const mockDb: any = { ...chain }
  return { db: mockDb }
})
vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id', stateVersion: 'state_version' },
  agentSections: { sessionId: 'session_id', sectionKey: 'section_key' },
  agentSectionVersions: { sectionId: 'section_id' },
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), max: vi.fn() }))

// ── Mock verifySessionOwnership so we control the session fixture ─────────

const mockVerifySessionOwnership = vi.fn()
vi.mock('@/lib/ai/agent/services/context-helpers', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/ai/agent/services/context-helpers')
  >('@/lib/ai/agent/services/context-helpers')
  return {
    ...actual,
    verifySessionOwnership: mockVerifySessionOwnership,
  }
})

// ── Constants ─────────────────────────────────────────────────────────────

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111'
const TEST_SESSION_ID = '22222222-2222-4222-8222-222222222222'

// Builds a minimal SectionSpec-shaped object.
function spec(id: string) {
  return {
    id,
    title: id,
    description: '',
    order: 1,
    generationOrder: 1,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: [],
    modelHint: 'light',
    mandatory: true,
    confidence: 0.9,
  }
}

// Builds a session that satisfies every saveSectionDraft precondition
// EXCEPT that the sectionKey under test is NOT in outline.
function makeSession(override: Record<string, unknown> = {}) {
  return {
    id: TEST_SESSION_ID,
    userId: TEST_USER_ID,
    projectId: null,
    status: 'active',
    locale: 'ro',
    selectedCallId: 'CALL-001',
    currentPhase: 'drafting',
    blueprint: null,
    eligibility: {
      results: [],
      score: 100,
      passCount: 0,
      failCount: 0,
      warningCount: 0,
    },
    outline: [spec('a'), spec('b')],
    warnings: [],
    planningArtifact: null,
    outlineFrozen: true,
    messageSummary: null,
    stateVersion: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...override,
  }
}

const ctx = {
  userId: TEST_USER_ID,
  requestId: 'test-request-id',
  now: new Date(),
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('saveSectionDraft policy gate — sectionKey not in outline', () => {
  beforeEach(() => {
    mockVerifySessionOwnership.mockReset()
  })

  it('rejects when sectionKey is not in outline', async () => {
    mockVerifySessionOwnership.mockResolvedValue(makeSession())

    const { saveSectionDraft } = await import('@/lib/ai/agent/services/sections')

    await expect(
      saveSectionDraft(ctx, {
        sessionId: TEST_SESSION_ID,
        sectionKey: 'ghost',
        content: 'some content',
        expectedStateVersion: 0,
      }),
    ).rejects.toThrow(/POLICY_SECTION_NOT_IN_OUTLINE/)
  })
})
