// app/tests/unit/ai/agent/runtime-prompt-restructure.test.ts
//
// Plan 2 PR 2a parity check: after splitting buildSystemPrompt into a stable
// prefix and buildSessionStateBlock (volatile tail), two consecutive turns in
// the same phase must deliver byte-identical req.system, with the volatile
// content appearing as the first role:'system' message in llmMessages.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const capturedCalls: Array<{
  system: string | undefined
  messages: Array<{ role: string; content: string }>
}> = []

const generateMock = vi.fn(async (req: {
  system?: string
  messages: Array<{ role: string; content: string }>
}) => {
  // Snapshot both system and messages (messages is a reference that runtime
  // keeps mutating across the tool loop; deep-copy is required).
  capturedCalls.push({
    system: req.system,
    messages: req.messages.map(m => ({ ...m })),
  })
  return {
    content: 'done',
    tokensUsed: { input: 0, output: 0 },
    model: 'claude-opus-4-6',
    provider: 'anthropic',
    toolCalls: [],
  }
})

// History mock is stateful: turn 1 sees no prior context; turn 2 sees a one-message history.
const historyState = { messages: [] as Array<{ role: string; content: string }>, summary: null as string | null }
vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: vi.fn(async () => ({ ...historyState, totalCount: historyState.messages.length })),
  appendMessage: vi.fn(async (_sid: string, msg: { role: string; content: unknown }) => {
    historyState.messages.push({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    })
    return 0
  }),
  compactIfNeeded: vi.fn(async () => ({ compacted: false })),
}))

vi.mock('@/lib/ai/providers/router', () => ({ generate: generateMock }))
vi.mock('@/lib/ai/agent/tools/registry', () => ({ getToolsForPhase: () => [] }))
vi.mock('@/lib/ai/agent/tools/index', () => ({}))
vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({ getSessionKnowledge: async () => [] }))
vi.mock('@/lib/ai/knowledge/write-back', () => ({
  onSectionAccepted: vi.fn(),
  onPhaseTransition: vi.fn(),
  trackPatternUsage: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        then: (resolve: (v: unknown) => void) => resolve(undefined),
      }),
    }),
  },
}))

import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active', locale: 'ro', selectedCallId: null, currentPhase: 'drafting',
    projectId: null,
    blueprint: null, eligibility: null, outline: null, warnings: [],
    outlineFrozen: false,
    planningArtifact: null, messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as AgentSession
}

beforeEach(() => {
  capturedCalls.length = 0
  historyState.messages = []
  historyState.summary = null
  generateMock.mockClear()
})

describe('V3 runtime — prompt restructure parity (PR 2a)', () => {
  it('req.system is byte-identical across two consecutive turns in the same phase', async () => {
    const session = makeSession({ currentPhase: 'drafting' })
    const sectionsT1: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'draft', documentOrder: 0 } as AgentSection,
    ]
    const sectionsT2: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'accepted', documentOrder: 0 } as AgentSection,
      { sectionKey: 'buget', title: 'B', status: 'draft', documentOrder: 1 } as AgentSection,
    ]

    await runAgentTurn({
      session, sections: sectionsT1,
      request: { message: 'turn 1', requestId: 'req-1', locale: 'ro' },
      emit: () => {},
    })
    await runAgentTurn({
      session, sections: sectionsT2,
      request: { message: 'turn 2', requestId: 'req-2', locale: 'ro' },
      emit: () => {},
    })

    expect(capturedCalls).toHaveLength(2)
    expect(capturedCalls[0].system).toBe(capturedCalls[1].system)
    expect(capturedCalls[0].system).toContain('FondEU')
    // Stable prefix must not contain volatile markers.
    expect(capturedCalls[0].system).not.toContain('Current Session State')
    expect(capturedCalls[0].system).not.toContain('Sections:')
  })

  it('first role:system message in llmMessages is the session-state block and differs across turns when sections change', async () => {
    const session = makeSession({ currentPhase: 'drafting' })
    const sectionsT1: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'draft', documentOrder: 0 } as AgentSection,
    ]
    const sectionsT2: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'accepted', documentOrder: 0 } as AgentSection,
    ]

    await runAgentTurn({
      session, sections: sectionsT1,
      request: { message: 'turn 1', requestId: 'req-1', locale: 'ro' },
      emit: () => {},
    })
    await runAgentTurn({
      session, sections: sectionsT2,
      request: { message: 'turn 2', requestId: 'req-2', locale: 'ro' },
      emit: () => {},
    })

    const firstSystemT1 = capturedCalls[0].messages.find(m => m.role === 'system')
    const firstSystemT2 = capturedCalls[1].messages.find(m => m.role === 'system')
    expect(firstSystemT1).toBeDefined()
    expect(firstSystemT2).toBeDefined()
    expect(firstSystemT1!.content.startsWith('## Current Session State')).toBe(true)
    expect(firstSystemT2!.content.startsWith('## Current Session State')).toBe(true)
    // T1 shows 'draft' for rezumat; T2 shows 'accepted'. Verifies volatility travels.
    expect(firstSystemT1!.content).toContain('rezumat: draft')
    expect(firstSystemT2!.content).toContain('rezumat: accepted')
    expect(firstSystemT1!.content).not.toBe(firstSystemT2!.content)
  })
})
