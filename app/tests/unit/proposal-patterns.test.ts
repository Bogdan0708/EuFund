// app/tests/unit/proposal-patterns.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{
      id: '44444444-4444-4444-8444-444444444444',
      program: 'PNRR',
      sectionType: 'methodology',
    }]),
  }),
})

vi.mock('@/lib/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import {
  createPattern,
  wilsonScore,
  rankPatterns,
} from '@/lib/ai/knowledge/proposal-patterns'

import { db } from '@/lib/db'

describe('proposal-patterns', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createPattern inserts a new pattern when no duplicate exists', async () => {
    const result = await createPattern({
      program: 'PNRR',
      sectionType: 'methodology',
      title: 'Strong methodology for green infrastructure',
      contentMd: '## Methodology\nPhased approach...',
      derivedFromSections: [{ sessionId: 's1', sectionKey: 'methodology', acceptedAt: '2026-04-08' }],
    })
    expect(result).toBeDefined()
    expect(mockInsert).toHaveBeenCalled()
  })

  it('createPattern updates existing pattern on repeated accept from same session', async () => {
    // Mock select to return an existing pattern with matching sourceSessionId
    const mockUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })
    ;(db.select as any).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: 'existing-pattern-id',
          program: 'PNRR',
          sectionType: 'methodology',
          frontmatter: { sourceSessionId: 's1' },
          title: 'Old title',
          contentMd: 'Old content',
        }]),
      }),
    })
    ;(db.update as any).mockReturnValueOnce(mockUpdate())

    const result = await createPattern({
      program: 'PNRR',
      sectionType: 'methodology',
      title: 'Updated methodology',
      contentMd: '## Updated\nBetter approach...',
      derivedFromSections: [{ sessionId: 's1', sectionKey: 'methodology', acceptedAt: '2026-04-08' }],
    })

    // Should NOT have inserted a new row
    expect(mockInsert).not.toHaveBeenCalled()
    // Should return the updated pattern
    expect(result.title).toBe('Updated methodology')
  })

  describe('wilsonScore', () => {
    it('returns 0 for zero uses', () => {
      expect(wilsonScore(0, 0)).toBe(0)
    })

    it('returns lower bound for 1/1 (not 1.0)', () => {
      const score = wilsonScore(1, 1)
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(0.9)
    })

    it('ranks 8/10 higher than 1/1', () => {
      const high = wilsonScore(10, 8)
      const oneHit = wilsonScore(1, 1)
      expect(high).toBeGreaterThan(oneHit)
    })

    it('ranks 80/100 higher than 8/10 (more data = tighter bounds)', () => {
      const large = wilsonScore(100, 80)
      const small = wilsonScore(10, 8)
      expect(large).toBeGreaterThan(small)
    })
  })

  describe('rankPatterns', () => {
    const patterns = [
      { id: 'a', timesUsed: 10, timesAccepted: 8, avgRegenCount: 0.5 },
      { id: 'b', timesUsed: 10, timesAccepted: 3, avgRegenCount: 2.1 },
      { id: 'c', timesUsed: 1, timesAccepted: 1, avgRegenCount: 0 },
      { id: 'd', timesUsed: 0, timesAccepted: 0, avgRegenCount: 0 },
    ] as any[]

    it('sorts patterns below minSupport threshold last', () => {
      const ranked = rankPatterns(patterns, { minSupport: 3 })
      expect(ranked[0].id).toBe('a')
      expect(ranked[ranked.length - 1].id).toBe('d')
      expect(ranked[ranked.length - 2].id).toBe('c')
    })

    it('ranks by Wilson score within threshold group', () => {
      const ranked = rankPatterns(patterns, { minSupport: 3 })
      const aIdx = ranked.findIndex((p: any) => p.id === 'a')
      const bIdx = ranked.findIndex((p: any) => p.id === 'b')
      expect(aIdx).toBeLessThan(bIdx)
    })
  })
})
