import { describe, it, expect } from 'vitest'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import type { AgentSection, AgentSession, SectionSpec } from '@/lib/ai/agent/types'

function spec(id: string, order: number, title: string): SectionSpec {
  return {
    id, title, description: '', order, generationOrder: order,
    importance: 'standard', expectedLength: 'medium', dependsOn: [],
    modelHint: 'light', mandatory: true, confidence: 0.9,
  }
}

describe('managed runtime snapshot virtual outline', () => {
  it('exposes pending virtual sections when outline is set and rows are empty', () => {
    const session = {
      id: 's', userId: 'u', projectId: null, status: 'active', locale: 'ro',
      selectedCallId: 'C-1', currentPhase: 'structuring',
      blueprint: null, eligibility: null,
      outline: [spec('a', 1, 'A'), spec('b', 2, 'B')],
      warnings: [], planningArtifact: null, outlineFrozen: false,
      messageSummary: null, stateVersion: 1,
      createdAt: new Date(0), updatedAt: new Date(0),
    } as AgentSession
    const snapshot = projectSessionState(session, [] as AgentSection[])
    expect(snapshot.sections.map(s => s.sectionKey)).toEqual(['a', 'b'])
    expect(snapshot.sections.every(s => s.status === 'pending')).toBe(true)
  })
})
