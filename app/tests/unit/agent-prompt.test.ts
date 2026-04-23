import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildSessionStateBlock } from '@/lib/ai/agent/prompt'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active', locale: 'ro', selectedCallId: null, currentPhase: 'discovery',
    projectId: null,
    blueprint: null, eligibility: null, outline: null, warnings: [],
    outlineFrozen: false,
    planningArtifact: null, messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

describe('buildSystemPrompt (stable cacheable prefix)', () => {
  it('includes agent persona', () => {
    const prompt = buildSystemPrompt(makeSession(), [])
    expect(prompt).toContain('FondEU')
    expect(prompt).toContain('cereri de finanțare')
  })

  it('includes current phase guidance', () => {
    const prompt = buildSystemPrompt(makeSession({ currentPhase: 'drafting' }), [])
    expect(prompt).toContain('Generate sections one at a time')
  })

  it('includes rules about not inventing facts', () => {
    const prompt = buildSystemPrompt(makeSession(), [])
    expect(prompt).toContain('Never invent')
  })

  it('is byte-identical across turns within the same phase when only sections/warnings change', () => {
    const sessionA = makeSession({ currentPhase: 'drafting', warnings: [] })
    const sessionB = makeSession({
      currentPhase: 'drafting',
      warnings: [{ code: 'X', message: 'y', severity: 'low' as const }],
    })
    const sectionsA: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'draft', documentOrder: 0 } as any,
    ]
    const sectionsB: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'accepted', documentOrder: 0 } as any,
      { sectionKey: 'buget', title: 'B', status: 'draft', documentOrder: 1 } as any,
    ]
    expect(buildSystemPrompt(sessionA, sectionsA)).toBe(buildSystemPrompt(sessionB, sectionsB))
  })

  it('differs across phases', () => {
    const s1 = buildSystemPrompt(makeSession({ currentPhase: 'drafting' }), [])
    const s2 = buildSystemPrompt(makeSession({ currentPhase: 'review' }), [])
    expect(s1).not.toBe(s2)
  })

  it('does NOT contain volatile session-state markers (those moved to buildSessionStateBlock)', () => {
    const prompt = buildSystemPrompt(makeSession(), [])
    expect(prompt).not.toContain('Current Session State')
    expect(prompt).not.toContain('Active warnings')
    expect(prompt).not.toContain('Session knowledge')
    // Also: blueprint/selectedCallId must no longer appear in the stable prefix.
    expect(prompt).not.toContain('Selected call:')
    expect(prompt).not.toContain('Structure confidence:')
  })
})

describe('buildSessionStateBlock (volatile tail, delivered as role:system message)', () => {
  it('includes blueprint info when present', () => {
    const block = buildSessionStateBlock(makeSession({
      blueprint: { callId: 'PNRR-C11', structureConfidence: 0.85 } as any,
    }), [])
    expect(block).toContain('PNRR-C11')
    expect(block).toContain('85%')
  })

  it('includes section statuses when present', () => {
    const sections: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'Rezumat executiv', status: 'accepted', documentOrder: 0 } as any,
      { sectionKey: 'buget', title: 'Buget', status: 'draft', documentOrder: 7 } as any,
    ]
    const block = buildSessionStateBlock(makeSession({ currentPhase: 'drafting' }), sections)
    expect(block).toContain('rezumat')
    expect(block).toContain('accepted')
    expect(block).toContain('draft')
  })

  it('includes session knowledge summary when present', () => {
    const session = {
      ...makeSession({ currentPhase: 'drafting' }),
      _knowledgeSummary: '3 pages: brief, decision_log, section_pattern(methodology)',
    } as any
    const block = buildSessionStateBlock(session, [])
    expect(block).toContain('Session knowledge')
    expect(block).toContain('3 pages')
  })

  it('shows "none yet" when no knowledge summary', () => {
    const block = buildSessionStateBlock(makeSession(), [])
    expect(block).toContain('Session knowledge: none yet')
  })

  it('reflects warning changes across turns (volatility is expected)', () => {
    const s1 = buildSessionStateBlock(makeSession({ warnings: [] }), [])
    const s2 = buildSessionStateBlock(makeSession({
      warnings: [{ code: 'W1', message: 'm', severity: 'medium' as const }],
    }), [])
    expect(s1).not.toBe(s2)
  })

  it('starts with "## Current Session State" heading for adapter hoisting recognizability', () => {
    const block = buildSessionStateBlock(makeSession(), [])
    expect(block.startsWith('## Current Session State')).toBe(true)
  })
})
