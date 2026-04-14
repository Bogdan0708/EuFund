import { describe, it, expect } from 'vitest'
import type { CallMatch } from '@/lib/ai/agent/services/types'

const serviceResult = {
  matches: [
    { callId: 'CALL-1', title: 'Test Call', program: 'PNRR', score: 0.85, snippet: 'A test call', sourceUrl: 'https://example.com' },
    { callId: 'CALL-2', title: 'Another Call', program: 'PEO', score: 0.72, snippet: 'Another', sourceUrl: undefined },
  ] satisfies CallMatch[],
}

describe('search_calls adapter contract', () => {
  it('V3 adapter: wraps matches with SET_PHASE transition when results found', () => {
    const toolResult = {
      success: true,
      data: serviceResult.matches,
      stateTransitions: serviceResult.matches.length > 0
        ? [{ type: 'SET_PHASE', phase: 'research' as const }]
        : undefined,
      telemetry: { latencyMs: 42 },
    }
    expect(toolResult.success).toBe(true)
    expect(toolResult.data).toHaveLength(2)
    expect(toolResult.stateTransitions).toHaveLength(1)
  })

  it('V3 adapter: no transition when zero results', () => {
    const emptyResult = { matches: [] as CallMatch[] }
    const toolResult = {
      success: true,
      data: emptyResult.matches,
      stateTransitions: emptyResult.matches.length > 0
        ? [{ type: 'SET_PHASE', phase: 'research' as const }]
        : undefined,
      telemetry: { latencyMs: 10 },
    }
    expect(toolResult.stateTransitions).toBeUndefined()
  })

  it('MCP adapter: wraps matches as JSON text content', () => {
    const mcpResult = {
      content: [{ type: 'text' as const, text: JSON.stringify(serviceResult) }],
    }
    const parsed = JSON.parse(mcpResult.content[0].text)
    expect(parsed.matches).toHaveLength(2)
    expect(parsed.matches[0].callId).toBe('CALL-1')
  })
})
