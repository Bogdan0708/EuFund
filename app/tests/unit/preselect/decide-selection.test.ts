import { describe, it, expect } from 'vitest'
import { decideSelection, SCORE_FLOOR, AMBIGUITY_EPSILON } from '@/lib/ai/agent/services/preselect'

describe('decideSelection', () => {
  const mk = (callId: string, score: number) => ({
    callId, title: `Call ${callId}`, score,
  })

  it('returns no_match with reason=empty_results for empty input', () => {
    expect(decideSelection([])).toEqual({ kind: 'no_match', reason: 'empty_results' })
  })

  it('returns no_match when top score is below floor', () => {
    const result = decideSelection([mk('a', SCORE_FLOOR - 0.01)])
    expect(result).toEqual({ kind: 'no_match', reason: 'below_score_floor' })
  })

  it('returns selected when single candidate is above floor', () => {
    const top = mk('a', 0.8)
    const result = decideSelection([top])
    expect(result).toEqual({ kind: 'selected', callId: 'a', candidates: [top] })
  })

  it('returns selected when top is clearly above runner-up', () => {
    const cands = [mk('a', 0.9), mk('b', 0.9 - AMBIGUITY_EPSILON - 0.01), mk('c', 0.5)]
    const result = decideSelection(cands)
    expect(result.kind).toBe('selected')
    if (result.kind === 'selected') {
      expect(result.callId).toBe('a')
      expect(result.candidates).toHaveLength(3)
    }
  })

  it('returns ambiguous when top-1 and top-2 are within epsilon', () => {
    const cands = [mk('a', 0.9), mk('b', 0.9 - AMBIGUITY_EPSILON + 0.01), mk('c', 0.5), mk('d', 0.4)]
    const result = decideSelection(cands)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(3)
      expect(result.candidates.map(c => c.callId)).toEqual(['a', 'b', 'c'])
    }
  })
})
