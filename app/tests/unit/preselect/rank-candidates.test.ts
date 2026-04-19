import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock searchCalls before importing rankCandidates
const { mockSearchCalls } = vi.hoisted(() => ({
  mockSearchCalls: vi.fn(),
}))

vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: mockSearchCalls,
}))

import { rankCandidates } from '@/lib/ai/agent/services/preselect'

const ctx = { userId: 'u1', sessionId: 's1' } as any

beforeEach(() => {
  mockSearchCalls.mockReset()
})

describe('rankCandidates', () => {
  it('returns empty when searchCalls returns no matches', async () => {
    mockSearchCalls.mockResolvedValue({ matches: [] })
    expect(await rankCandidates(ctx, 'nothing here')).toEqual([])
  })

  it('passes through searchCalls output, sliced to top-5', async () => {
    const matches = [1, 2, 3, 4, 5, 6, 7].map(i => ({
      callId: `c${i}`, title: `Call ${i}`, program: 'P', score: 1 - i * 0.01,
      snippet: '', sourceUrl: undefined,
    }))
    mockSearchCalls.mockResolvedValue({ matches })
    const result = await rankCandidates(ctx, 'query')
    expect(result).toHaveLength(5)
    expect(result.map(r => r.callId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
  })

  it('filters out excluded callIds and keeps remaining order', async () => {
    const matches = ['a', 'b', 'c', 'd'].map((id, i) => ({
      callId: id, title: id, program: 'P', score: 1 - i * 0.1, snippet: '', sourceUrl: undefined,
    }))
    mockSearchCalls.mockResolvedValue({ matches })
    const result = await rankCandidates(ctx, 'q', ['a', 'c'])
    expect(result.map(r => r.callId)).toEqual(['b', 'd'])
  })

  it('removes the top match when it is excluded', async () => {
    const matches = [
      { callId: 'top', title: 'Top', program: 'P', score: 0.9, snippet: '', sourceUrl: undefined },
      { callId: 'two', title: 'Two', program: 'P', score: 0.7, snippet: '', sourceUrl: undefined },
    ]
    mockSearchCalls.mockResolvedValue({ matches })
    const result = await rankCandidates(ctx, 'q', ['top'])
    expect(result.map(r => r.callId)).toEqual(['two'])
  })
})
