import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock vector store before importing the tool
vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(() => ({
    search: vi.fn().mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'PNRR Component 11 - Green energy transition call',
        score: 0.92,
        metadata: {
          callId: 'PNRR-C11-001',
          callTitle: 'Green Energy Transition',
          program: 'PNRR',
          sourceUrl: 'https://example.com/pnrr',
        },
      },
      {
        id: 'chunk-2',
        content: 'PNRR Component 11 - additional details',
        score: 0.88,
        metadata: {
          callId: 'PNRR-C11-001',
          callTitle: 'Green Energy Transition',
          program: 'PNRR',
        },
      },
      {
        id: 'chunk-3',
        content: 'PEO digital transformation fund',
        score: 0.75,
        metadata: {
          callId: 'PEO-DIG-002',
          callTitle: 'Digital Transformation',
          program: 'PEO',
        },
      },
    ]),
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

// Import AFTER mocks
import '@/lib/ai/agent/tools/search-calls'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('search_calls tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: {} as any,
    sections: [],
    stateVersion: 0,
    requestId: 'req-1',
    locale: 'ro' as const,
  }

  it('is registered in the tool registry', () => {
    const tools = getToolRegistry()
    const searchTool = tools.find(t => t.name === 'search_calls')
    expect(searchTool).toBeDefined()
    expect(searchTool!.category).toBe('read')
  })

  it('returns deduplicated call matches', async () => {
    const tools = getToolRegistry()
    const searchTool = tools.find(t => t.name === 'search_calls')!
    const result = await searchTool.execute({ query: 'green energy', maxResults: 5 }, mockCtx)

    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2) // 3 chunks but 2 unique callIds
    expect(result.data![0].callId).toBe('PNRR-C11-001')
    expect(result.data![1].callId).toBe('PEO-DIG-002')
  })

  it('emits SET_PHASE transition when results found', async () => {
    const tools = getToolRegistry()
    const searchTool = tools.find(t => t.name === 'search_calls')!
    const result = await searchTool.execute({ query: 'green energy', maxResults: 5 }, mockCtx)

    expect(result.stateTransitions).toBeDefined()
    expect(result.stateTransitions![0]).toEqual({ type: 'SET_PHASE', phase: 'research' })
  })

  it('includes telemetry', async () => {
    const tools = getToolRegistry()
    const searchTool = tools.find(t => t.name === 'search_calls')!
    const result = await searchTool.execute({ query: 'green energy', maxResults: 5 }, mockCtx)

    expect(result.telemetry.latencyMs).toBeGreaterThanOrEqual(0)
  })
})
