import { describe, it, expect } from 'vitest'
import { agentSectionToSectionResult } from '@/lib/workspace'
import type { agentSections } from '@/lib/db/schema'

type AgentSectionRow = typeof agentSections.$inferSelect

function makeRow(overrides: Partial<AgentSectionRow> = {}): AgentSectionRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    sectionKey: 'rezumat',
    title: 'Rezumat executiv',
    documentOrder: 0,
    generationOrder: 11,
    status: 'draft',
    content: 'draft content',
    acceptedContent: null,
    modelUsed: 'claude-sonnet-4-6',
    retryCount: 0,
    sourcesUsed: null,
    promptVersion: null,
    latencyMs: 1500,
    tokenUsage: null,
    errorClass: null,
    rejectionReason: null,
    updatedAt: new Date('2026-05-12T10:00:00Z'),
    ...overrides,
  }
}

describe('agentSectionToSectionResult', () => {
  it('prefers acceptedContent over content', () => {
    const row = makeRow({ content: 'draft', acceptedContent: 'final' })
    const result = agentSectionToSectionResult(row)
    expect(result.content).toBe('final')
  })

  it('falls back to content when acceptedContent is null', () => {
    const row = makeRow({ content: 'draft', acceptedContent: null })
    const result = agentSectionToSectionResult(row)
    expect(result.content).toBe('draft')
  })

  it('handles fully empty content with empty-string fallback', () => {
    const row = makeRow({ content: null, acceptedContent: null })
    const result = agentSectionToSectionResult(row)
    expect(result.content).toBe('')
  })

  it('maps accepted status → approved state', () => {
    const row = makeRow({ status: 'accepted' })
    expect(agentSectionToSectionResult(row).state).toBe('approved')
  })

  it('maps needs_review status → reviewed state', () => {
    const row = makeRow({ status: 'needs_review' })
    expect(agentSectionToSectionResult(row).state).toBe('reviewed')
  })

  it('maps all other V3 statuses → draft state', () => {
    for (const status of ['pending', 'generating', 'draft', 'stale', 'invalidated', 'failed', 'rejected'] as const) {
      const row = makeRow({ status })
      expect(agentSectionToSectionResult(row).state, `status=${status}`).toBe('draft')
    }
  })

  it('produces a stable SHA-256 contentHash from the resolved content', () => {
    const row = makeRow({ content: 'same content', acceptedContent: null })
    const result = agentSectionToSectionResult(row)
    expect(result.contentHash).toHaveLength(64)
    expect(agentSectionToSectionResult(row).contentHash).toBe(result.contentHash)
  })

  it('uses documentOrder for SectionResult.order', () => {
    const row = makeRow({ documentOrder: 5 })
    expect(agentSectionToSectionResult(row).order).toBe(5)
  })

  it('carries retryCount and latencyMs through metadata', () => {
    const row = makeRow({ retryCount: 3, latencyMs: 2200 })
    const meta = agentSectionToSectionResult(row).metadata
    expect(meta.retryCount).toBe(3)
    expect(meta.latencyMs).toBe(2200)
  })

  it('parses tokenUsage.input/output into metadata.tokensIn/Out', () => {
    const row = makeRow({ tokenUsage: { input: 1200, output: 800 } })
    const meta = agentSectionToSectionResult(row).metadata
    expect(meta.tokensIn).toBe(1200)
    expect(meta.tokensOut).toBe(800)
  })

  it('accepts the in/out token shape variant', () => {
    const row = makeRow({ tokenUsage: { in: 100, out: 50 } })
    const meta = agentSectionToSectionResult(row).metadata
    expect(meta.tokensIn).toBe(100)
    expect(meta.tokensOut).toBe(50)
  })

  it('defaults tokenUsage to 0 when null', () => {
    const row = makeRow({ tokenUsage: null })
    const meta = agentSectionToSectionResult(row).metadata
    expect(meta.tokensIn).toBe(0)
    expect(meta.tokensOut).toBe(0)
  })

  it('returns the agentSections.id as SectionResult.id', () => {
    const row = makeRow({ id: 'deadbeef-dead-4eef-8eef-deadbeefdead' })
    expect(agentSectionToSectionResult(row).id).toBe('deadbeef-dead-4eef-8eef-deadbeefdead')
  })
})
