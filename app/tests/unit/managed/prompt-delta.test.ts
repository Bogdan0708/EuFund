import { describe, it, expect } from 'vitest'
import { buildManagedSystemPrompt } from '@/lib/ai/agent/managed/prompt'
import type { AgentSession } from '@/lib/ai/agent/types'

const baseSession: AgentSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  projectId: null,
  status: 'active',
  locale: 'ro',
  selectedCallId: null,
  currentPhase: 'drafting',
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
}

describe('Phase 3b minimal prompt delta', () => {
  it('removes Phase 2 read-only lockdown language in EN', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).not.toMatch(/writes are not available|read-only pilot/i)
  })

  it('removes Phase 2 read-only lockdown language in RO', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro')
    expect(ro).not.toMatch(/scrierile nu sunt disponibile|pilot de citire|doar citire/i)
  })

  const writeNames = [
    'save_section_draft',
    'approve_revision',
    'rollback_section',
    'set_application_status',
    'set_selected_call',
    'freeze_outline',
    'mark_section_stale',
    'reject_section',
  ]

  it('lists all 8 write tool names in EN', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    for (const name of writeNames) {
      expect(en, `missing ${name} in EN prompt`).toContain(name)
    }
  })

  it('lists all 8 write tool names in RO', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro')
    for (const name of writeNames) {
      expect(ro, `missing ${name} in RO prompt`).toContain(name)
    }
  })

  it('includes the confirm-before-write hard rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).toMatch(/explicit user (intent|confirmation)|before (calling|executing) any write/i)
  })

  it('includes the no-parallel-writes rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).toMatch(/one (write )?at a time|never.*parallel|single write|PARALLEL_WRITE_BLOCKED/i)
  })

  it('includes the concurrency recovery rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).toMatch(/expectedStateVersion|get_application_state/i)
  })

  it('includes the policy-code recovery rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).toMatch(/POLICY_/)
  })

  it('backwards compat: 4-arg call still works', () => {
    const result = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(100)
  })
})
