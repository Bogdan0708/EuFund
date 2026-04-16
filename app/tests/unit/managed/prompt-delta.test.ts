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

describe('Phase 3b minimal prompt delta (allowWrites=true)', () => {
  it('removes Phase 2 read-only lockdown language in EN', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', true)
    expect(en).not.toMatch(/writes are not available|read-only pilot/i)
  })

  it('removes Phase 2 read-only lockdown language in RO', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', true)
    expect(ro).not.toMatch(/scrierile nu sunt disponibile|pilot de citire|doar citire/i)
  })

  it('lists all 8 write tool names in EN', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', true)
    for (const name of writeNames) {
      expect(en, `missing ${name} in EN prompt`).toContain(name)
    }
  })

  it('lists all 8 write tool names in RO', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', true)
    for (const name of writeNames) {
      expect(ro, `missing ${name} in RO prompt`).toContain(name)
    }
  })

  it('includes the confirm-before-write hard rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', true)
    expect(en).toMatch(/explicit user (intent|confirmation)|before (calling|executing) any write/i)
  })

  it('includes the no-parallel-writes rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', true)
    expect(en).toMatch(/one (write )?at a time|never.*parallel|single write|PARALLEL_WRITE_BLOCKED/i)
  })

  it('includes the concurrency recovery rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', true)
    expect(en).toMatch(/expectedStateVersion|get_application_state/i)
  })

  it('includes the policy-code recovery rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', true)
    expect(en).toMatch(/POLICY_/)
  })

  it('accepts the 6-arg signature with summary', () => {
    const result = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', true, 'some summary')
    expect(result).toMatch(/Prior conversation summary/)
  })
})

describe('Phase 3b prompt delta (allowWrites=false — read-only surface)', () => {
  it('omits write tool names from RO and EN prompts', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', false)
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', false)
    for (const name of writeNames) {
      expect(ro, `RO should not mention ${name}`).not.toContain(name)
      expect(en, `EN should not mention ${name}`).not.toContain(name)
    }
  })

  it('omits the "Write tool rules" section in RO', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', false)
    expect(ro).not.toMatch(/Reguli pentru instrumentele de scriere/)
    expect(ro).not.toMatch(/PARALLEL_WRITE_BLOCKED/)
    expect(ro).not.toMatch(/POLICY_/)
  })

  it('omits the "Write tool rules" section in EN', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', false)
    expect(en).not.toMatch(/Write tool rules/)
    expect(en).not.toMatch(/PARALLEL_WRITE_BLOCKED/)
    expect(en).not.toMatch(/POLICY_/)
  })

  it('still includes the read + rules tool list in both locales', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', false)
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', false)
    for (const name of ['search_calls', 'retrieve_evidence', 'run_eligibility', 'validate_application']) {
      expect(en).toContain(name)
      expect(ro).toContain(name)
    }
  })

  it('preserves master read-only-pilot semantics: only discovery + research, writes deferred to standard workflow', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', false)
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', false)
    expect(ro).toMatch(/Doar .*descoperire.*cercetare/i)
    expect(ro).toMatch(/fluxul standard/i)
    expect(en).toMatch(/Only .*discovery.* and .*research/i)
    expect(en).toMatch(/standard workflow/i)
  })

  it('does NOT claim full-workflow coverage when allowWrites=false', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', false)
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', false)
    expect(ro).not.toMatch(/Ghidezi utilizatorul prin întregul flux/)
    expect(en).not.toMatch(/guide the user through the full workflow/i)
  })
})

describe('Phase 3b prompt delta (allowWrites=true — full-workflow surface)', () => {
  it('advertises the full workflow (discovery through review)', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', true)
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', true)
    expect(ro).toMatch(/întregul flux|structurare.*redactare.*revizuire/i)
    expect(en).toMatch(/full workflow|structuring.*drafting.*review/i)
  })

  it('does NOT include read-only mode copy when allowWrites=true', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', true)
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', true)
    expect(ro).not.toMatch(/doar-citire|doar citire/i)
    expect(en).not.toMatch(/read-only/i)
    expect(ro).not.toMatch(/Rămâi în modul doar-citire/i)
    expect(en).not.toMatch(/Stay in read-only mode/i)
  })
})
