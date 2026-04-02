import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SECTIONS,
  buildSectionSpecs,
  compactPreviousSections,
} from '@/lib/ai/orchestrator/section-specs'
import type { CallBlueprint, SectionResult, SectionSpec } from '@/lib/ai/orchestrator/types'

// Minimal CallBlueprint factory
function makeBlueprint(requiredSections: SectionSpec[] = []): CallBlueprint {
  return {
    callId: 'test-call',
    program: 'TEST',
    isOpen: true,
    amendments: [],
    warnings: [],
    requiredSections: [],
    mandatoryAnnexes: [],
    eligibilityCriteria: [],
    evaluationGrid: [],
    cofinancingRate: 0.8,
    eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
    sources: [],
    verifiedAt: new Date().toISOString(),
    raw: { notebookLmResponse: '', perplexityResponse: '', retrievedAt: '' },
    normalized: {
      requiredSections,
      mandatoryAnnexes: [],
      eligibilityCriteria: [],
      evaluationGrid: [],
      cofinancingRate: 0.8,
    },
    structureConfidence: 1,
  }
}

function makeSpec(overrides: Partial<SectionSpec>): SectionSpec {
  return {
    id: 'test-section',
    title: 'Test Section',
    description: 'A test section',
    order: 1,
    generationOrder: 1,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: [],
    modelHint: 'light',
    mandatory: true,
    confidence: 1,
    ...overrides,
  }
}

function makeSectionResult(overrides: Partial<SectionResult>): SectionResult {
  return {
    id: 'test-section',
    title: 'Test Section',
    content: 'Content here.',
    order: 1,
    source: 'generated',
    metadata: {
      model: 'gpt-4',
      provider: 'openai',
      tokensIn: 100,
      tokensOut: 200,
      latencyMs: 500,
      retryCount: 0,
      fallbackUsed: false,
      generatedAt: new Date().toISOString(),
      checksum: 'abc123',
    },
    ...overrides,
  }
}

// ─── buildSectionSpecs ─────────────────────────────────────────────────────

describe('buildSectionSpecs', () => {
  it('uses blueprint requiredSections when they are present, sorted by generationOrder', () => {
    const specs: SectionSpec[] = [
      makeSpec({ id: 'b', generationOrder: 3 }),
      makeSpec({ id: 'a', generationOrder: 1 }),
      makeSpec({ id: 'c', generationOrder: 2 }),
    ]
    const result = buildSectionSpecs(makeBlueprint(specs))
    expect(result.map((s) => s.id)).toEqual(['a', 'c', 'b'])
  })

  it('falls back to DEFAULT_SECTIONS when blueprint has no requiredSections', () => {
    const result = buildSectionSpecs(makeBlueprint([]))
    expect(result.length).toBe(DEFAULT_SECTIONS.length)
    // Verify they are sorted by generationOrder
    for (let i = 1; i < result.length; i++) {
      expect(result[i].generationOrder).toBeGreaterThanOrEqual(result[i - 1].generationOrder)
    }
  })

  it('rezumat has the highest generationOrder in DEFAULT_SECTIONS', () => {
    const sorted = buildSectionSpecs(makeBlueprint([]))
    const last = sorted[sorted.length - 1]
    expect(last.id).toBe('rezumat')
    expect(last.generationOrder).toBe(11)
  })
})

// ─── compactPreviousSections ───────────────────────────────────────────────

describe('compactPreviousSections', () => {
  it('returns empty string when no previous sections', () => {
    const spec = makeSpec({ dependsOn: [] })
    expect(compactPreviousSections([], spec)).toBe('')
  })

  it('includes full text for sections in dependsOn', () => {
    const longContent = 'A'.repeat(500)
    const sections: SectionResult[] = [
      makeSectionResult({ id: 'context', title: 'Context', content: longContent, order: 1 }),
    ]
    const spec = makeSpec({ id: 'obiective', dependsOn: ['context'] })
    const result = compactPreviousSections(sections, spec)
    expect(result).toContain(longContent)
  })

  it('includes full text for last 2 generated sections', () => {
    const sections: SectionResult[] = [
      makeSectionResult({ id: 's1', title: 'S1', content: 'Full content of S1 '.repeat(20), order: 1 }),
      makeSectionResult({ id: 's2', title: 'S2', content: 'Full content of S2 '.repeat(20), order: 2 }),
      makeSectionResult({ id: 's3', title: 'S3', content: 'Full content of S3 '.repeat(20), order: 3 }),
      makeSectionResult({ id: 's4', title: 'S4', content: 'Full content of S4 '.repeat(20), order: 4 }),
    ]
    const spec = makeSpec({ id: 'current', dependsOn: [] })
    const result = compactPreviousSections(sections, spec)

    // s3 and s4 are last 2, should have full text
    expect(result).toContain('Full content of S3')
    expect(result).toContain('Full content of S4')
  })

  it('compresses earlier non-dependency sections to summary only', () => {
    // 4 sections, current depends on none
    // s1 and s2 should be compressed (summary); s3 and s4 are last 2 (full text)
    const makeContent = (id: string) =>
      `First sentence of ${id}. Second sentence of ${id}. Third sentence that should be cut.`

    const sections: SectionResult[] = [
      makeSectionResult({ id: 's1', title: 'S1', content: makeContent('s1'), order: 1 }),
      makeSectionResult({ id: 's2', title: 'S2', content: makeContent('s2'), order: 2 }),
      makeSectionResult({ id: 's3', title: 'S3', content: makeContent('s3'), order: 3 }),
      makeSectionResult({ id: 's4', title: 'S4', content: makeContent('s4'), order: 4 }),
    ]

    const spec = makeSpec({ id: 'current', dependsOn: [] })
    const result = compactPreviousSections(sections, spec)

    // s1 and s2 are summaries — they have the [rezumat] marker
    expect(result).toContain('S1 [rezumat]')
    expect(result).toContain('S2 [rezumat]')
    // s3 and s4 are full (last 2) — no summary marker
    expect(result).not.toContain('S3 [rezumat]')
    expect(result).not.toContain('S4 [rezumat]')
    // s1 summary: first two sentences present, third sentence absent from its summary block
    // We verify by checking s1's summary doesn't include the 3rd sentence
    // (s3/s4 full text do include it, but s1/s2 summaries should not)
    const s1Block = result.split('---')[0] // s1 is the first block
    expect(s1Block).not.toContain('Third sentence that should be cut')
  })

  it('does not include the full text of ALL sections when there are many', () => {
    // Create 6 sections, none depended on — only last 2 should be full
    const sections: SectionResult[] = Array.from({ length: 6 }, (_, i) =>
      makeSectionResult({
        id: `s${i + 1}`,
        title: `Section ${i + 1}`,
        content: `Unique marker FULL_${i + 1}. ` + 'extra text. '.repeat(30),
        order: i + 1,
      }),
    )

    const spec = makeSpec({ id: 'current', dependsOn: [] })
    const result = compactPreviousSections(sections, spec)

    // s5 and s6 are full — their markers should appear in full content, not summary
    // s1-s4 are summaries — their markers appear only in first 2 sentences
    // The summary text still starts with "Unique marker FULL_N" (first sentence)
    // but the "extra text. " repetition from the 3rd sentence onwards should be absent for s1-s4
    // Verify summary marker present for earlier sections (title is 'Section N')
    expect(result).toContain('Section 1 [rezumat]')
    expect(result).toContain('Section 4 [rezumat]')
    // Full sections don't have the marker
    expect(result).not.toContain('Section 5 [rezumat]')
    expect(result).not.toContain('Section 6 [rezumat]')
  })
})
