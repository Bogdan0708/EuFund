// Regression: cached requiredSections may already be full SectionSpec[]
// (resolve_call's LLM-extraction path writes them that way in
// tools/resolve-call.ts:122). PR5's materializer forced every entry through
// synthetic defaults, clobbering id/order/importance/dependsOn/mandatory/
// modelHint when those were already present. The materializer now passes
// through fully-shaped rows and only synthesizes for partial rows.

import { describe, it, expect } from 'vitest'
import { materializeCachedSections } from '@/lib/ai/agent/services/blueprint'
import type { SectionSpec } from '@/lib/ai/agent/types'

describe('materializeCachedSections — full vs partial', () => {
  it('passes through fully-shaped SectionSpec rows unchanged', () => {
    const full: SectionSpec = {
      id: 'custom-id-from-llm',
      title: 'Activitățile proiectului',
      description: 'desc',
      order: 3,
      generationOrder: 5,
      importance: 'critical',
      expectedLength: 'long',
      dependsOn: ['context-si-justificare', 'obiective'],
      modelHint: 'heavy',
      evaluationWeight: 20,
      mandatory: false,
      confidence: 0.92,
    }
    const result = materializeCachedSections([full], 0.5 /* should NOT override */)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(full)
  })

  it('synthesizes defaults for partial rows missing id/order', () => {
    const partial = [
      { title: 'Context și justificare', description: 'd', evaluationWeight: 10 },
    ]
    const [s] = materializeCachedSections(partial, 0.75)
    expect(s.id).toBe('context-si-justificare')
    expect(s.order).toBe(1)
    expect(s.generationOrder).toBe(1)
    expect(s.importance).toBe('standard')
    expect(s.dependsOn).toEqual([])
    expect(s.modelHint).toBe('heavy')
    expect(s.mandatory).toBe(true)
    expect(s.confidence).toBe(0.75)
  })

  it('handles a mix of full and partial rows in a single cached payload', () => {
    const mixed = [
      {
        id: 'objectives',
        title: 'Objectives',
        description: 'd',
        order: 1,
        generationOrder: 1,
        importance: 'critical',
        expectedLength: 'medium',
        dependsOn: [],
        modelHint: 'light',
        mandatory: true,
        confidence: 0.9,
      } as SectionSpec,
      { title: 'Buget', description: 'd' },
    ]
    const result = materializeCachedSections(mixed, 0.6)
    expect(result[0].id).toBe('objectives')
    expect(result[0].importance).toBe('critical')
    expect(result[1].id).toBe('buget')
    expect(result[1].importance).toBe('standard')
  })
})
