import { describe, it, expect } from 'vitest'
import { outlineFromBlueprint } from '@/lib/ai/agent/services/blueprint'
import type { CallBlueprint, SectionSpec } from '@/lib/ai/agent/types'

function makeFullSpec(over: Partial<SectionSpec> = {}): SectionSpec {
  return {
    id: 'intro',
    title: 'Introducere',
    description: 'Project overview',
    order: 1,
    generationOrder: 1,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: [],
    modelHint: 'light',
    mandatory: true,
    confidence: 0.9,
    ...over,
  }
}

function makeBlueprint(sections: unknown[], structureConfidence = 0.9): CallBlueprint {
  return {
    callId: 'C-1',
    program: 'PNRR',
    isOpen: true,
    amendments: [],
    warnings: [],
    requiredSections: [],
    mandatoryAnnexes: [],
    eligibilityCriteria: [],
    evaluationGrid: [],
    cofinancingRate: 0,
    eligibilityResult: {
      score: 0,
      passCount: 0,
      failCount: 0,
      failures: [],
      warnings: [],
    },
    sources: [],
    verifiedAt: '2026-05-12T00:00:00.000Z',
    raw: {
      notebookLmResponse: '',
      perplexityResponse: '',
      retrievedAt: '2026-05-12T00:00:00.000Z',
    },
    normalized: {
      requiredSections: sections as SectionSpec[],
      mandatoryAnnexes: [],
      eligibilityCriteria: [],
      evaluationGrid: [],
      cofinancingRate: 0,
    },
    structureConfidence,
  }
}

describe('outlineFromBlueprint', () => {
  it('passes full SectionSpec rows through unchanged', () => {
    const a = makeFullSpec({ id: 'a', order: 1 })
    const b = makeFullSpec({ id: 'b', order: 2, title: 'Buget' })
    const bp = makeBlueprint([a, b])
    expect(outlineFromBlueprint(bp)).toEqual([a, b])
  })

  it('materializes partial cached rows with defaults', () => {
    const partial = [{ title: 'Cadru', description: 'Context legal' }]
    const bp = makeBlueprint(partial, 0.7)
    const out = outlineFromBlueprint(bp)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Cadru')
    expect(out[0].description).toBe('Context legal')
    expect(out[0].order).toBe(1)
    expect(out[0].generationOrder).toBe(1)
    expect(out[0].confidence).toBe(0.7)
    expect(out[0].id).toMatch(/^cadru/)
  })

  it('returns empty array for blueprint with zero sections', () => {
    expect(outlineFromBlueprint(makeBlueprint([]))).toEqual([])
  })
})
