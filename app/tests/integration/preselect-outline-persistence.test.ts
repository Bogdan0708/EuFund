import { describe, it, expect, vi } from 'vitest'

const insertedRows: { values: Record<string, unknown>[]; returningCols: string[] }[] = []

vi.mock('@/lib/db', () => {
  return {
    withUserRLS: async (_uid: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: () => ({
          values: (v: Record<string, unknown>) => ({
            returning: () => {
              insertedRows.push({ values: [v], returningCols: ['id'] })
              return Promise.resolve([{ id: 'new-session-id' }])
            },
          }),
        }),
      }
      return fn(tx)
    },
  }
})

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/projects/promotion', () => ({
  ensureProjectForSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/agent/services/blueprint', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/agent/services/blueprint')>(
    '@/lib/ai/agent/services/blueprint'
  )
  return {
    ...actual,
    lookupBlueprint: vi.fn().mockResolvedValue({
      cached: true,
      blueprint: {
        callId: 'C-1', program: 'PNRR', isOpen: true, deadline: null,
        cofinancingRate: 0,
        sources: { eurLexId: null, portalId: null, cordisId: null,
          notebookLmResponse: '', perplexityResponse: '',
          retrievedAt: '2026-05-12T00:00:00.000Z' },
        normalized: {
          requiredSections: [{
            id: 'intro', title: 'Introducere', description: '', order: 1,
            generationOrder: 1, importance: 'standard', expectedLength: 'medium',
            dependsOn: [], modelHint: 'light', mandatory: true, confidence: 0.9,
          }],
          mandatoryAnnexes: [], eligibilityCriteria: [],
          evaluationGrid: [], cofinancingRate: 0,
        },
        structureConfidence: 0.9,
      } as unknown as import('@/lib/ai/agent/types').CallBlueprint,
    }),
  }
})

describe('preselect initializeSession outline persistence', () => {
  it('writes outline alongside blueprint when blueprintKind=structured', async () => {
    insertedRows.length = 0
    const { initializeSession } = await import('@/lib/ai/agent/services/preselect')
    await initializeSession({
      userId: 'u', description: 'desc', locale: 'ro',
      selectedCallId: 'C-1', selectedScore: 0.9,
      candidates: [{ callId: 'C-1', title: 'T', score: 0.9 }],
      excludeCallIdsApplied: [],
    })
    expect(insertedRows).toHaveLength(1)
    const v = insertedRows[0].values[0] as Record<string, unknown>
    expect(v.blueprint).toBeTruthy()
    expect(v.outline).toBeTruthy()
    expect(Array.isArray(v.outline)).toBe(true)
    expect((v.outline as Array<{ id: string }>)[0].id).toBe('intro')
  })
})
