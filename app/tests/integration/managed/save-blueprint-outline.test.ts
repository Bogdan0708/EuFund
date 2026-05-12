import { describe, it, expect } from 'vitest'

// Test the outlineFromBlueprint contract end-to-end with a representative
// blueprint shape — this verifies the helper produces the expected outline
// for the kind of payloads save_call_blueprint will hand it.
describe('save_call_blueprint outline derivation', () => {
  it('produces non-empty outline with correct ids and importance from a typical blueprint', async () => {
    const { outlineFromBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    const bp = {
      callId: 'C-1', program: 'PNRR', isOpen: true, deadline: null,
      cofinancingRate: 0,
      sources: { eurLexId: null, portalId: null, cordisId: null,
        notebookLmResponse: '', perplexityResponse: '',
        retrievedAt: '2026-05-12T00:00:00.000Z' },
      normalized: {
        requiredSections: [{
          id: 'budget', title: 'Buget', description: '', order: 1,
          generationOrder: 1, importance: 'critical', expectedLength: 'long',
          dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 0.85,
        }],
        mandatoryAnnexes: [], eligibilityCriteria: [],
        evaluationGrid: [], cofinancingRate: 0,
      },
      structureConfidence: 0.85,
    } as unknown as import('@/lib/ai/agent/types').CallBlueprint
    const outline = outlineFromBlueprint(bp)
    expect(outline).toHaveLength(1)
    expect(outline[0].id).toBe('budget')
    expect(outline[0].importance).toBe('critical')
  })
})
