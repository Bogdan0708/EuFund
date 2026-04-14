// app/tests/unit/knowledge-write-back.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockUpsertSessionKnowledge, mockCreatePattern, mockRecordPatternUsage } = vi.hoisted(() => ({
  mockUpsertSessionKnowledge: vi.fn().mockResolvedValue({ id: 'sk-1' }),
  mockCreatePattern: vi.fn().mockResolvedValue({ id: 'pp-1' }),
  mockRecordPatternUsage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({
  upsertSessionKnowledge: mockUpsertSessionKnowledge,
}))

vi.mock('@/lib/ai/knowledge/proposal-patterns', () => ({
  createPattern: mockCreatePattern,
  recordPatternUsage: mockRecordPatternUsage,
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import {
  onSectionAccepted,
  onPhaseTransition,
  shouldDistillPattern,
  trackPatternUsage,
} from '@/lib/ai/knowledge/write-back'

describe('knowledge write-back', () => {
  beforeEach(() => vi.clearAllMocks())

  it('onSectionAccepted upserts a section_pattern knowledge page with provenance', async () => {
    await onSectionAccepted({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sectionKey: 'methodology',
      title: 'Metodologie',
      content: '## Approach\nPhased implementation with milestones...',
      program: 'PNRR',
      callId: 'pnrr-2026-call-1',
      retryCount: 0,
      modelUsed: 'claude-opus-4-6',
      sectionId: '55555555-5555-4555-8555-555555555555',
      sourcesUsed: ['qdrant-chunk-1', 'qdrant-chunk-2'],
    })

    expect(mockUpsertSessionKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '11111111-1111-4111-8111-111111111111',
        kind: 'section_pattern',
        slug: 'section-methodology',
        sourceRefs: ['qdrant-chunk-1', 'qdrant-chunk-2'],
      }),
    )
    // Verify provenance in frontmatter
    const call = mockUpsertSessionKnowledge.mock.calls[0][0]
    expect(call.frontmatter.callId).toBe('pnrr-2026-call-1')
    expect(call.frontmatter.program).toBe('PNRR')
  })

  it('onSectionAccepted is idempotent — second call updates same slug', async () => {
    await onSectionAccepted({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sectionKey: 'methodology',
      title: 'Metodologie v2',
      content: '## Updated approach',
      program: 'PNRR',
      callId: 'pnrr-2026-call-1',
      retryCount: 1,
      modelUsed: 'claude-opus-4-6',
      sectionId: '55555555-5555-4555-8555-555555555555',
      sourcesUsed: [],
    })

    expect(mockUpsertSessionKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'section-methodology' }),
    )
  })

  it('shouldDistillPattern returns true for zero-retry, long sections', () => {
    expect(shouldDistillPattern({ retryCount: 0, contentLength: 1000 })).toBe(true)
  })

  it('shouldDistillPattern returns false for high-retry sections', () => {
    expect(shouldDistillPattern({ retryCount: 3, contentLength: 1000 })).toBe(false)
  })

  it('shouldDistillPattern returns false for short content', () => {
    expect(shouldDistillPattern({ retryCount: 0, contentLength: 100 })).toBe(false)
  })

  it('onSectionAccepted distills pattern when shouldDistillPattern is true', async () => {
    await onSectionAccepted({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sectionKey: 'context',
      title: 'Context și justificare',
      content: 'A'.repeat(1500),
      program: 'PNRR',
      callId: 'pnrr-2026-call-1',
      retryCount: 0,
      modelUsed: 'claude-opus-4-6',
      sectionId: '55555555-5555-4555-8555-555555555555',
      sourcesUsed: ['chunk-1'],
    })

    expect(mockCreatePattern).toHaveBeenCalledWith(
      expect.objectContaining({ program: 'PNRR', sectionType: 'context' }),
    )
    // Verify sourceSessionId in frontmatter for idempotent upsert matching
    const patternCall = mockCreatePattern.mock.calls[0][0]
    expect(patternCall.frontmatter.sourceSessionId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('onSectionAccepted does NOT distill pattern when retryCount > 1', async () => {
    await onSectionAccepted({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sectionKey: 'context',
      title: 'Context',
      content: 'A'.repeat(1500),
      program: 'PNRR',
      callId: null,
      retryCount: 3,
      modelUsed: 'claude-opus-4-6',
      sectionId: '55555555-5555-4555-8555-555555555555',
      sourcesUsed: [],
    })

    expect(mockCreatePattern).not.toHaveBeenCalled()
  })

  it('onPhaseTransition upserts decision_log', async () => {
    await onPhaseTransition({
      sessionId: '11111111-1111-4111-8111-111111111111',
      fromPhase: 'structuring',
      toPhase: 'drafting',
      messageSummary: 'User approved outline with 11 sections',
      planningArtifact: { projectSummary: 'Green energy project' },
    })

    expect(mockUpsertSessionKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'decision_log',
        slug: 'phase-structuring-to-drafting',
      }),
    )
  })

  it('trackPatternUsage calls recordPatternUsage for each ID', async () => {
    await trackPatternUsage(['pp-1', 'pp-2'], { accepted: true, regenCount: 0 })
    expect(mockRecordPatternUsage).toHaveBeenCalledTimes(2)
  })

  it('trackPatternUsage swallows individual failures', async () => {
    mockRecordPatternUsage.mockRejectedValueOnce(new Error('DB error'))
    await expect(
      trackPatternUsage(['pp-1', 'pp-2'], { accepted: false }),
    ).resolves.not.toThrow()
  })
})
