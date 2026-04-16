import { describe, it, expect } from 'vitest'
import { buildManagedSystemPrompt } from '@/lib/ai/agent/managed/prompt'
import type { AgentSession } from '@/lib/ai/agent/types'

const mockSession: AgentSession = {
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
}

describe('buildManagedSystemPrompt (allowWrites=false, read-only default)', () => {
  it('returns a non-empty string for Romanian locale', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('restricts to discovery + research only when allowWrites=false', () => {
    const ro = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    const en = buildManagedSystemPrompt({ ...mockSession, locale: 'en' }, [], 'discovery', 'en', false)
    // Both locales should explicitly limit phase coverage and defer the
    // write-side phases to the standard workflow.
    expect(ro).toMatch(/Doar .*descoperire.*cercetare|doar-citire/i)
    expect(ro).toMatch(/fluxul standard/i)
    expect(en).toMatch(/Only .*discovery.* and .*research|read-only/i)
    expect(en).toMatch(/standard workflow/i)
  })

  it('communicates read-only mode to the model when allowWrites=false', () => {
    const ro = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    const en = buildManagedSystemPrompt({ ...mockSession, locale: 'en' }, [], 'discovery', 'en', false)
    expect(ro).toMatch(/doar-citire|doar citire/i)
    expect(en).toMatch(/read-only/i)
  })

  it('instructs the model to stay in read-only mode if the user asks for a write', () => {
    const ro = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    const en = buildManagedSystemPrompt({ ...mockSession, locale: 'en' }, [], 'discovery', 'en', false)
    expect(ro).toMatch(/Rămâi în modul doar-citire/i)
    expect(en).toMatch(/Stay in read-only mode/i)
  })

  it('references tool categories', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    expect(prompt.toLowerCase()).toMatch(/tool|instrument|apel/)
  })

  it('switches language on locale change', () => {
    const ro = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    const en = buildManagedSystemPrompt({ ...mockSession, locale: 'en' }, [], 'discovery', 'en', false)
    expect(ro).not.toBe(en)
  })

  it('includes hard rules (evidence discipline, no invented facts)', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    expect(prompt.toLowerCase()).toMatch(/evidence|dovezi|nu inventa|never invent/)
  })

  it('includes current phase indicator', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    expect(prompt.toLowerCase()).toMatch(/discovery|descoperire/)
  })

  it('does NOT reference write tools when allowWrites is false', () => {
    const ro = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    const en = buildManagedSystemPrompt({ ...mockSession, locale: 'en' }, [], 'discovery', 'en', false)
    const writeTools = [
      'save_section_draft', 'approve_revision', 'rollback_section',
      'set_application_status', 'set_selected_call', 'freeze_outline',
      'mark_section_stale', 'reject_section',
    ]
    for (const name of writeTools) {
      expect(ro, `RO prompt should not mention ${name}`).not.toContain(name)
      expect(en, `EN prompt should not mention ${name}`).not.toContain(name)
    }
  })

  it('does NOT include the "Write tool rules" block when allowWrites is false', () => {
    const ro = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro', false)
    const en = buildManagedSystemPrompt({ ...mockSession, locale: 'en' }, [], 'discovery', 'en', false)
    expect(ro).not.toMatch(/Reguli pentru instrumentele de scriere/)
    expect(en).not.toMatch(/Write tool rules/)
    expect(ro).not.toMatch(/PARALLEL_WRITE_BLOCKED/)
    expect(en).not.toMatch(/PARALLEL_WRITE_BLOCKED/)
  })
})

describe('buildManagedSystemPrompt priorSummary parameter', () => {
  it('appends Romanian label when priorSummary is provided in ro locale', () => {
    const result = buildManagedSystemPrompt(mockSession, [], 'drafting', 'ro', false, 'Rezumat de test')
    expect(result).toMatch(/## Rezumat conversație anterioară/)
    expect(result.endsWith('Rezumat de test')).toBe(true)
    expect(result).not.toMatch(/<conversation_summary>/)
  })

  it('appends English label in en locale', () => {
    const result = buildManagedSystemPrompt(mockSession, [], 'drafting', 'en', false, 'Test summary')
    expect(result).toMatch(/## Prior conversation summary/)
    expect(result.endsWith('Test summary')).toBe(true)
    expect(result).not.toMatch(/<conversation_summary>/)
  })

  it('omits the label when priorSummary is null', () => {
    const result = buildManagedSystemPrompt(mockSession, [], 'drafting', 'en', false, null)
    expect(result).not.toMatch(/Prior conversation summary/)
    expect(result).not.toMatch(/Rezumat conversație anterioară/)
  })

  it('omits the label when priorSummary is omitted (5-arg call)', () => {
    const result = buildManagedSystemPrompt(mockSession, [], 'drafting', 'en', false)
    expect(result).not.toMatch(/Prior conversation summary/)
    expect(result.length).toBeGreaterThan(100)
  })
})
