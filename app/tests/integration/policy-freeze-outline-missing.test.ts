// ── freezeOutline policy gate: outline not ready ──────────────────────────
// Verifies that freezeOutline throws POLICY_OUTLINE_NOT_READY when the
// session has no outline (null or empty array), even when every other
// precondition is satisfied: status=active, call selected, outlineFrozen=false,
// eligibility=null (checked after outline so irrelevant here).
//
// Hermetic: no real DB. verifySessionOwnership is mocked to return a
// controlled fixture; the policy gate throws before any DB mutation fires.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock stubs needed by the application.ts module graph ─────────────────

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
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }))
vi.mock('@/lib/projects/promotion', () => ({
  ensureProjectForSession: vi.fn().mockResolvedValue(undefined),
}))

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

// Builds a minimal AgentSession-shaped row that satisfies every policy
// precondition EXCEPT the outline requirement, so the only gate that fires
// is requiresOutlinePresent.
function makeSession(override: Record<string, unknown> = {}) {
  return {
    id: TEST_SESSION_ID,
    userId: TEST_USER_ID,
    projectId: null,
    status: 'active',
    locale: 'ro',
    selectedCallId: 'CALL-001',
    currentPhase: 'structuring',
    blueprint: null,
    eligibility: null,   // checked AFTER outline — won't be reached
    outline: null,
    warnings: [],
    planningArtifact: null,
    outlineFrozen: false,
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

describe('freezeOutline policy gate — outline missing', () => {
  beforeEach(() => {
    mockVerifySessionOwnership.mockReset()
  })

  it('rejects when outline is null', async () => {
    mockVerifySessionOwnership.mockResolvedValue(makeSession({ outline: null }))

    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    await expect(
      freezeOutline(ctx, { sessionId: TEST_SESSION_ID, expectedStateVersion: 0 }),
    ).rejects.toThrow(/POLICY_OUTLINE_NOT_READY/)
  })

  it('rejects when outline is an empty array', async () => {
    mockVerifySessionOwnership.mockResolvedValue(makeSession({ outline: [] }))

    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    await expect(
      freezeOutline(ctx, { sessionId: TEST_SESSION_ID, expectedStateVersion: 0 }),
    ).rejects.toThrow(/POLICY_OUTLINE_NOT_READY/)
  })
})
