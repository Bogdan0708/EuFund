// app/tests/unit/agent-runtime-structured-action-guards.test.ts
import { describe, it, expect, vi } from 'vitest'

// Mock all external dependencies — handleStructuredAction is pure in-memory,
// but the module imports db and other side-effectful modules at load time.
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}))

vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: vi.fn().mockResolvedValue({ messages: [], summary: null, totalCount: 0 }),
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
  ensureV3PairingInvariant: (m: unknown[]) => m,
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({ content: 'ok', tokensUsed: { input: 0, output: 0 }, model: 'm', provider: 'p', toolCalls: [] }),
}))

vi.mock('@/lib/ai/knowledge/write-back', () => ({
  onSectionAccepted: vi.fn().mockResolvedValue(undefined),
  onPhaseTransition: vi.fn().mockResolvedValue(undefined),
  trackPatternUsage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({
  getSessionKnowledge: vi.fn().mockResolvedValue([]),
}))

import { handleStructuredAction } from '@/lib/ai/agent/runtime'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    projectId: null,
    status: 'active',
    locale: 'ro',
    selectedCallId: null,
    currentPhase: 'discovery',
    blueprint: null,
    eligibility: null,
    outline: null,
    warnings: [],
    planningArtifact: null,
    outlineFrozen: false,
    messageSummary: null,
    stateVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeSection(overrides: Partial<AgentSection> = {}): AgentSection {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    sessionId: '11111111-1111-4111-8111-111111111111',
    sectionKey: 'buget',
    title: 'Buget',
    documentOrder: 1,
    generationOrder: 1,
    status: 'draft',
    content: null,
    acceptedContent: null,
    modelUsed: null,
    retryCount: 0,
    sourcesUsed: null,
    promptVersion: null,
    latencyMs: null,
    tokenUsage: null,
    errorClass: null,
    rejectionReason: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('handleStructuredAction V3 precondition guards', () => {
  // ---------------------------------------------------------------------------
  // select_call
  // ---------------------------------------------------------------------------
  describe('select_call', () => {
    it('rejects when session status is not active', () => {
      const result = handleStructuredAction(
        { type: 'select_call', callId: 'CALL-1' },
        makeSession({ status: 'paused' }),
        [],
      )
      expect(result.policyViolation).toMatch(/POLICY_SESSION_NOT_ACTIVE/)
      expect(result.transitions).toHaveLength(0)
      expect(result.skipLLM).toBe(true)
    })

    it('rejects when outline is already frozen', () => {
      const result = handleStructuredAction(
        { type: 'select_call', callId: 'CALL-1' },
        makeSession({ outlineFrozen: true }),
        [],
      )
      expect(result.policyViolation).toMatch(/POLICY_OUTLINE_ALREADY_FROZEN/)
      expect(result.transitions).toHaveLength(0)
      expect(result.skipLLM).toBe(true)
    })

    it('allows when session is active and outline is not frozen', () => {
      const result = handleStructuredAction(
        { type: 'select_call', callId: 'CALL-1' },
        makeSession({ status: 'active', outlineFrozen: false }),
        [],
      )
      expect(result.policyViolation).toBeUndefined()
      expect(result.transitions).toHaveLength(1)
      expect(result.transitions[0]).toEqual({ type: 'SET_SELECTED_CALL', callId: 'CALL-1' })
      expect(result.skipLLM).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // approve_outline
  // ---------------------------------------------------------------------------
  describe('approve_outline', () => {
    it('rejects when session status is not active', () => {
      const result = handleStructuredAction(
        { type: 'approve_outline' },
        makeSession({ status: 'completed', selectedCallId: 'CALL-1', eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 } }),
        [],
      )
      expect(result.policyViolation).toMatch(/POLICY_SESSION_NOT_ACTIVE/)
      expect(result.transitions).toHaveLength(0)
    })

    it('rejects when no call is selected', () => {
      const result = handleStructuredAction(
        { type: 'approve_outline' },
        makeSession({ selectedCallId: null, eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 } }),
        [],
      )
      expect(result.policyViolation).toMatch(/POLICY_NO_CALL_SELECTED/)
      expect(result.transitions).toHaveLength(0)
    })

    it('rejects with POLICY_ELIGIBILITY_NOT_CHECKED and a real sentence when eligibility was never run (en)', () => {
      // User report 2026-05-12: pressing "approve outline" surfaced
      // `failCount: unknown` — that token came from `?? 'unknown'`. Replace
      // with an actionable message and a distinct policy code so the user
      // (and the model on the next turn) knows what to do.
      const result = handleStructuredAction(
        { type: 'approve_outline' },
        makeSession({ locale: 'en', selectedCallId: 'CALL-1', eligibility: null }),
        [],
      )
      expect(result.policyViolation).toMatch(/POLICY_ELIGIBILITY_NOT_CHECKED/)
      expect(result.policyViolation).not.toContain('failCount: unknown')
      expect(result.policyViolation).toContain('run an eligibility check')
      expect(result.transitions).toHaveLength(0)
    })

    it('uses Romanian copy when locale is ro and eligibility is null', () => {
      const result = handleStructuredAction(
        { type: 'approve_outline' },
        makeSession({ locale: 'ro', selectedCallId: 'CALL-1', eligibility: null }),
        [],
      )
      expect(result.policyViolation).toMatch(/POLICY_ELIGIBILITY_NOT_CHECKED/)
      expect(result.policyViolation).toContain('eligibilitate')
    })

    it('rejects with POLICY_ELIGIBILITY_NOT_PASSED and concrete fail count when eligibility ran and failed', () => {
      const result = handleStructuredAction(
        { type: 'approve_outline' },
        makeSession({ locale: 'en', selectedCallId: 'CALL-1', eligibility: { results: [], score: 60, passCount: 3, failCount: 2, warningCount: 0 } }),
        [],
      )
      expect(result.policyViolation).toMatch(/POLICY_ELIGIBILITY_NOT_PASSED/)
      expect(result.policyViolation).toContain('2 hard failure')
    })

    it('rejects when outline is already frozen', () => {
      const result = handleStructuredAction(
        { type: 'approve_outline' },
        makeSession({ selectedCallId: 'CALL-1', eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 }, outlineFrozen: true }),
        [],
      )
      expect(result.policyViolation).toMatch(/POLICY_OUTLINE_ALREADY_FROZEN/)
    })

    it('allows when all preconditions are met', () => {
      const result = handleStructuredAction(
        { type: 'approve_outline' },
        makeSession({
          status: 'active',
          selectedCallId: 'CALL-1',
          eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
          outlineFrozen: false,
        }),
        [],
      )
      expect(result.policyViolation).toBeUndefined()
      expect(result.transitions).toHaveLength(2)
      expect(result.transitions[0]).toEqual({ type: 'FREEZE_OUTLINE' })
      expect(result.transitions[1]).toEqual({ type: 'SET_PHASE', phase: 'drafting' })
      expect(result.skipLLM).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // regenerate_section
  // ---------------------------------------------------------------------------
  describe('regenerate_section', () => {
    it('rejects when outline is not frozen', () => {
      const result = handleStructuredAction(
        { type: 'regenerate_section', sectionKey: 'buget', feedback: 'more detail' },
        makeSession({ outlineFrozen: false }),
        [makeSection({ sectionKey: 'buget', status: 'draft' })],
      )
      expect(result.policyViolation).toMatch(/POLICY_OUTLINE_NOT_FROZEN/)
      expect(result.transitions).toHaveLength(0)
      expect(result.skipLLM).toBe(true)
    })

    it('rejects when section is not found', () => {
      const result = handleStructuredAction(
        { type: 'regenerate_section', sectionKey: 'nonexistent', feedback: '' },
        makeSession({ outlineFrozen: true }),
        [],
      )
      expect(result.policyViolation).toContain('"nonexistent" not found')
    })

    it('rejects when section status is "pending" (not in allowed set)', () => {
      const result = handleStructuredAction(
        { type: 'regenerate_section', sectionKey: 'buget', feedback: '' },
        makeSession({ outlineFrozen: true }),
        [makeSection({ sectionKey: 'buget', status: 'pending' })],
      )
      expect(result.policyViolation).toMatch(/POLICY_SECTION_WRONG_STATE/)
      expect(result.policyViolation).toContain("status 'pending'")
    })

    it('allows regenerate from draft status', () => {
      const result = handleStructuredAction(
        { type: 'regenerate_section', sectionKey: 'buget', feedback: '' },
        makeSession({ outlineFrozen: true }),
        [makeSection({ sectionKey: 'buget', status: 'draft' })],
      )
      expect(result.policyViolation).toBeUndefined()
      expect(result.transitions).toEqual([{ type: 'MARK_SECTION_STALE', sectionKey: 'buget' }])
    })

    it('allows regenerate from needs_review status', () => {
      const result = handleStructuredAction(
        { type: 'regenerate_section', sectionKey: 'buget', feedback: '' },
        makeSession({ outlineFrozen: true }),
        [makeSection({ sectionKey: 'buget', status: 'needs_review' })],
      )
      expect(result.policyViolation).toBeUndefined()
    })

    it('allows regenerate from accepted status', () => {
      const result = handleStructuredAction(
        { type: 'regenerate_section', sectionKey: 'buget', feedback: '' },
        makeSession({ outlineFrozen: true }),
        [makeSection({ sectionKey: 'buget', status: 'accepted' })],
      )
      expect(result.policyViolation).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // reject_section
  // ---------------------------------------------------------------------------
  describe('reject_section', () => {
    it('rejects when outline is not frozen', () => {
      const result = handleStructuredAction(
        { type: 'reject_section', sectionKey: 'context', reason: 'wrong focus' },
        makeSession({ outlineFrozen: false }),
        [makeSection({ sectionKey: 'context', status: 'draft' })],
      )
      expect(result.policyViolation).toMatch(/POLICY_OUTLINE_NOT_FROZEN/)
      expect(result.transitions).toHaveLength(0)
      expect(result.skipLLM).toBe(true)
    })

    it('rejects when section is not found', () => {
      const result = handleStructuredAction(
        { type: 'reject_section', sectionKey: 'nonexistent', reason: 'bad' },
        makeSession({ outlineFrozen: true }),
        [],
      )
      expect(result.policyViolation).toContain('"nonexistent" not found')
    })

    it('rejects when section status is "accepted" (not in allowed set)', () => {
      const result = handleStructuredAction(
        { type: 'reject_section', sectionKey: 'context', reason: 'bad' },
        makeSession({ outlineFrozen: true }),
        [makeSection({ sectionKey: 'context', status: 'accepted' })],
      )
      expect(result.policyViolation).toMatch(/POLICY_SECTION_WRONG_STATE/)
      expect(result.policyViolation).toContain("status 'accepted'")
    })

    it('allows reject from draft status', () => {
      const result = handleStructuredAction(
        { type: 'reject_section', sectionKey: 'context', reason: 'off-topic' },
        makeSession({ outlineFrozen: true }),
        [makeSection({ sectionKey: 'context', status: 'draft' })],
      )
      expect(result.policyViolation).toBeUndefined()
      expect(result.transitions).toEqual([{ type: 'REJECT_SECTION', sectionKey: 'context', reason: 'off-topic' }])
      expect(result.skipLLM).toBe(true)
    })

    it('allows reject from needs_review status', () => {
      const result = handleStructuredAction(
        { type: 'reject_section', sectionKey: 'context', reason: 'bad' },
        makeSession({ outlineFrozen: true }),
        [makeSection({ sectionKey: 'context', status: 'needs_review' })],
      )
      expect(result.policyViolation).toBeUndefined()
    })

    it('allows reject from rejected status (idempotent)', () => {
      const result = handleStructuredAction(
        { type: 'reject_section', sectionKey: 'context', reason: 'still bad' },
        makeSession({ outlineFrozen: true }),
        [makeSection({ sectionKey: 'context', status: 'rejected' })],
      )
      expect(result.policyViolation).toBeUndefined()
    })
  })
})
