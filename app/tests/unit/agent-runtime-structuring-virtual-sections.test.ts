// Regression: when a V3 session enters `structuring`, SET_OUTLINE writes
// session.outline but no agent_sections rows exist yet (they're only
// created when generate_section runs). The previous buildUISnapshot mapped
// directly off the sections[] argument, so the client saw an empty
// sections list — AgentWorkspace's `phase === 'structuring' && sections
// .length > 0` guard never fired, and the OutlineView with the Approve
// button never rendered. User dead-end.
//
// Runtime now projects session.outline into virtual section rows (status =
// 'pending') when no real rows exist. Once generate_section runs and the
// real row appears, those take over.

import { describe, it, expect, vi } from 'vitest'

const { ensureProjectForSessionMock } = vi.hoisted(() => ({
  ensureProjectForSessionMock: vi.fn().mockResolvedValue({ promoted: true }),
}))

vi.mock('@/lib/projects/promotion', () => ({
  ensureProjectForSession: ensureProjectForSessionMock,
}))

vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined), returning: vi.fn().mockResolvedValue([]) }) }),
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

vi.mock('@/lib/ai/agent/managed/history', () => ({
  markTurnCompleted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({ content: '', tokensUsed: { input: 0, output: 0 }, model: 'm', provider: 'p', toolCalls: [] }),
}))

vi.mock('@/lib/ai/knowledge/write-back', () => ({
  onSectionAccepted: vi.fn().mockResolvedValue(undefined),
  onPhaseTransition: vi.fn().mockResolvedValue(undefined),
  trackPatternUsage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({
  getSessionKnowledge: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}))

import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentSession, AgentSection, AgentRequest, AgentEvent } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    projectId: null,
    status: 'active',
    locale: 'ro',
    selectedCallId: 'CALL-XYZ',
    currentPhase: 'structuring',
    blueprint: null,
    eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
    outline: [
      {
        id: 'context-si-justificare',
        title: 'Context și justificare',
        description: 'd',
        order: 1,
        generationOrder: 1,
        importance: 'critical',
        expectedLength: 'long',
        dependsOn: [],
        modelHint: 'heavy',
        mandatory: true,
        confidence: 0.9,
      },
      {
        id: 'obiective',
        title: 'Obiective',
        description: 'd',
        order: 2,
        generationOrder: 2,
        importance: 'standard',
        expectedLength: 'medium',
        dependsOn: ['context-si-justificare'],
        modelHint: 'light',
        mandatory: true,
        confidence: 0.85,
      },
    ],
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

describe('V3 runtime — virtual sections from outline', () => {
  it('emits structuring-phase UI snapshot with virtual sections when no rows exist', async () => {
    const sessionWithOutline = makeSession()
    const events: AgentEvent[] = []
    // approve_outline action is skipLLM with policy gate; it emits done after
    // applying transitions. We pass an action that does NOT mutate (no
    // matching action means short-circuit) — but we actually want any action
    // that lets the runtime finish. Use a no-op-ish: request_refresh emits
    // done with the current state.
    const request: AgentRequest = {
      sessionId: sessionWithOutline.id,
      action: { type: 'request_refresh' },
      requestId: 'req-virt-1',
      locale: 'ro',
      stateVersion: 0,
    }

    await runAgentTurn({
      session: sessionWithOutline,
      sections: [],
      request,
      emit: (e) => events.push(e),
      turnId: '44444444-4444-4444-8444-444444444444',
    })

    const done = events.find(e => e.type === 'done') as Extract<AgentEvent, { type: 'done' }> | undefined
    expect(done).toBeDefined()
    expect(done!.finalState.sections).toHaveLength(2)
    expect(done!.finalState.sections[0]).toMatchObject({
      sectionKey: 'context-si-justificare',
      title: 'Context și justificare',
      status: 'pending',
      documentOrder: 1,
    })
    expect(done!.finalState.sections[1].sectionKey).toBe('obiective')
  })

  it('prefers real agent_sections rows over outline when both exist', async () => {
    const sessionWithOutline = makeSession()
    const realSection: AgentSection = {
      id: '33333333-3333-4333-8333-333333333333',
      sessionId: sessionWithOutline.id,
      sectionKey: 'context-si-justificare',
      title: 'Context și justificare',
      documentOrder: 1,
      generationOrder: 1,
      status: 'draft',
      content: 'Some drafted content',
      acceptedContent: null,
      modelUsed: 'claude',
      retryCount: 0,
      sourcesUsed: null,
      promptVersion: null,
      latencyMs: null,
      tokenUsage: null,
      errorClass: null,
      rejectionReason: null,
      updatedAt: new Date(),
    }
    const events: AgentEvent[] = []
    const request: AgentRequest = {
      sessionId: sessionWithOutline.id,
      action: { type: 'request_refresh' },
      requestId: 'req-virt-2',
      locale: 'ro',
      stateVersion: 0,
    }

    await runAgentTurn({
      session: sessionWithOutline,
      sections: [realSection],
      request,
      emit: (e) => events.push(e),
      turnId: '55555555-5555-4555-8555-555555555555',
    })

    const done = events.find(e => e.type === 'done') as Extract<AgentEvent, { type: 'done' }> | undefined
    // Centralized key-based merge: real row for 'context-si-justificare' takes
    // precedence; 'obiective' (in outline but no row yet) appears as virtual
    // 'pending'. Total = 2 (1 real + 1 virtual).
    expect(done!.finalState.sections).toHaveLength(2)
    expect(done!.finalState.sections[0]).toMatchObject({
      sectionKey: 'context-si-justificare',
      status: 'draft',
      content: 'Some drafted content',
    })
    expect(done!.finalState.sections[1]).toMatchObject({
      sectionKey: 'obiective',
      status: 'pending',
      content: null,
    })
  })
})
