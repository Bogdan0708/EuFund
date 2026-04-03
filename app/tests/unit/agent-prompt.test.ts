import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '@/lib/ai/agent/prompt'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active', locale: 'ro', selectedCallId: null, currentPhase: 'discovery',
    blueprint: null, eligibility: null, outline: null, warnings: [],
    outlineFrozen: false,
    planningArtifact: null, messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

describe('buildSystemPrompt', () => {
  it('includes agent persona', () => {
    const prompt = buildSystemPrompt(makeSession(), [])
    expect(prompt).toContain('FondEU')
    expect(prompt).toContain('cereri de finanțare')
  })

  it('includes current phase', () => {
    const prompt = buildSystemPrompt(makeSession({ currentPhase: 'drafting' }), [])
    expect(prompt).toContain('drafting')
  })

  it('includes blueprint info when present', () => {
    const prompt = buildSystemPrompt(makeSession({
      blueprint: { callId: 'PNRR-C11', structureConfidence: 0.85 } as any,
    }), [])
    expect(prompt).toContain('PNRR-C11')
    expect(prompt).toContain('85%')
  })

  it('includes section statuses when present', () => {
    const sections: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'Rezumat executiv', status: 'accepted', documentOrder: 0 } as any,
      { sectionKey: 'buget', title: 'Buget', status: 'draft', documentOrder: 7 } as any,
    ]
    const prompt = buildSystemPrompt(makeSession({ currentPhase: 'drafting' }), sections)
    expect(prompt).toContain('rezumat')
    expect(prompt).toContain('accepted')
    expect(prompt).toContain('draft')
  })

  it('includes rules about not inventing facts', () => {
    const prompt = buildSystemPrompt(makeSession(), [])
    expect(prompt).toContain('Never invent')
  })
})
