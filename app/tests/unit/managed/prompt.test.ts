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

describe('buildManagedSystemPrompt', () => {
  it('returns a non-empty string for Romanian locale', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('includes Phase 2 scope notice (read-only)', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    expect(prompt.toLowerCase()).toMatch(/read.?only|nu poți scrie|doar citire/)
  })

  it('references tool categories', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    expect(prompt.toLowerCase()).toMatch(/tool|instrument|apel/)
  })

  it('switches language on locale change', () => {
    const ro = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    const en = buildManagedSystemPrompt({ ...mockSession, locale: 'en' }, [], 'discovery', 'en')
    expect(ro).not.toBe(en)
  })

  it('includes hard rules (evidence discipline, no invented facts)', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    expect(prompt.toLowerCase()).toMatch(/evidence|dovezi|nu inventa|never invent/)
  })

  it('includes current phase indicator', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    expect(prompt.toLowerCase()).toMatch(/discovery|descoperire/)
  })

  it('does not reference write tools', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    const writeTools = ['save_section_draft', 'approve_revision', 'rollback_section']
    for (const name of writeTools) {
      expect(prompt).not.toContain(name)
    }
  })
})
