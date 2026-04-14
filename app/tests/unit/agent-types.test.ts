import { describe, it, expect } from 'vitest'
import type {
  AgentSession, AgentSection, AgentSectionVersion, AgentMessage,
  AgentCheckpoint, ToolDefinition, ToolContext, ToolResult,
  StateTransition, AgentEvent, StructuredAction, UIStateSnapshot,
  Phase, SessionStatus, SectionStatus, CheckpointType,
  PlanningArtifact, Warning,
} from '@/lib/ai/agent/types'
import { PHASES, SESSION_STATUSES, SECTION_STATUSES, CHECKPOINT_TYPES } from '@/lib/ai/agent/types'

describe('Agent V3 Types', () => {
  it('exports phase constants', () => {
    expect(PHASES).toContain('discovery')
    expect(PHASES).toContain('research')
    expect(PHASES).toContain('structuring')
    expect(PHASES).toContain('drafting')
    expect(PHASES).toContain('review')
    expect(PHASES).toHaveLength(5)
  })

  it('exports session status constants', () => {
    expect(SESSION_STATUSES).toContain('active')
    expect(SESSION_STATUSES).toContain('completed')
    expect(SESSION_STATUSES).toContain('error')
  })

  it('exports section status constants', () => {
    expect(SECTION_STATUSES).toContain('pending')
    expect(SECTION_STATUSES).toContain('stale')
    expect(SECTION_STATUSES).toContain('invalidated')
    expect(SECTION_STATUSES).toContain('accepted')
  })

  it('exports checkpoint type constants', () => {
    expect(CHECKPOINT_TYPES).toContain('call_selected')
    expect(CHECKPOINT_TYPES).toContain('structure_approved')
    expect(CHECKPOINT_TYPES).toContain('section_accepted')
    expect(CHECKPOINT_TYPES).toContain('proposal_completed')
  })

  it('StructuredAction covers all user actions', () => {
    const actions: StructuredAction[] = [
      { type: 'select_call', callId: 'test-123' },
      { type: 'approve_outline' },
      { type: 'accept_section', sectionKey: 'rezumat' },
      { type: 'regenerate_section', sectionKey: 'buget', feedback: 'more detail' },
      { type: 'reject_section', sectionKey: 'context', reason: 'wrong focus' },
      { type: 'request_refresh' },
      { type: 'mark_complete' },
    ]
    expect(actions).toHaveLength(7)
  })

  it('StateTransition discriminated union covers all mutations', () => {
    const transitions: StateTransition[] = [
      { type: 'SET_SELECTED_CALL', callId: 'call-1' },
      { type: 'SET_BLUEPRINT', blueprint: {} as any },
      { type: 'SET_ELIGIBILITY', result: {} as any },
      { type: 'SET_OUTLINE', outline: [] },
      { type: 'FREEZE_OUTLINE' },
      { type: 'SET_PHASE', phase: 'drafting' },
      { type: 'SET_WARNINGS', warnings: [] },
      { type: 'ADD_WARNING', warning: { code: 'W1', message: 'test', severity: 'medium' } },
      { type: 'SET_PLANNING_ARTIFACT', artifact: { projectSummary: 'test' } },
      { type: 'UPSERT_SECTION_DRAFT', sectionKey: 'rezumat', content: 'text', model: 'opus', sources: [] },
      { type: 'ACCEPT_SECTION', sectionKey: 'rezumat' },
      { type: 'REJECT_SECTION', sectionKey: 'rezumat', reason: 'bad' },
      { type: 'MARK_SECTION_STALE', sectionKey: 'rezumat' },
      { type: 'INVALIDATE_ALL_SECTIONS' },
      { type: 'SET_STATUS', status: 'completed' },
    ]
    expect(transitions).toHaveLength(15)
  })

  it('AgentEvent discriminated union covers all SSE events', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', content: 'hello' },
      { type: 'tool_start', tool: 'search_calls', input: {} },
      { type: 'tool_result', tool: 'search_calls', summary: 'found 3', success: true },
      { type: 'phase_changed', from: 'discovery', to: 'research' },
      { type: 'section_status', sectionKey: 'rezumat', status: 'draft' },
      { type: 'checkpoint', checkpointType: 'call_selected', summary: 'PNRR call selected' },
      { type: 'state_update', patch: { phase: 'research' } },
      { type: 'policy_violation', gate: 'pre_generate', reason: 'outline not approved' },
      { type: 'error', message: 'timeout', retryable: true },
      { type: 'done', finalState: { sessionId: '1', phase: 'drafting', stateVersion: 5, warnings: [], sections: [], blueprint: null, eligibility: null } },
    ]
    expect(events).toHaveLength(10)
  })
})
