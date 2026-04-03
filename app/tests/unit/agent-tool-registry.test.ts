import { describe, it, expect } from 'vitest'
import { getToolRegistry, getToolsForPhase } from '@/lib/ai/agent/tools/registry'

describe('Tool Registry', () => {
  it('returns all registered tools', () => {
    const tools = getToolRegistry()
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.category).toMatch(/^(read|decision|generation)$/)
      expect(tool.description).toBeTruthy()
      expect(tool.timeout).toBeGreaterThan(0)
    }
  })

  it('getToolsForPhase always includes read tools', () => {
    const phases = ['discovery', 'research', 'structuring', 'drafting', 'review'] as const
    for (const phase of phases) {
      const tools = getToolsForPhase(phase)
      const readTools = tools.filter(t => t.category === 'read')
      expect(readTools.length).toBeGreaterThan(0)
    }
  })

  it('discovery phase has search_calls', () => {
    const tools = getToolsForPhase('discovery')
    expect(tools.find(t => t.name === 'search_calls')).toBeDefined()
  })

  it('drafting phase has generate_section', () => {
    const tools = getToolsForPhase('drafting')
    expect(tools.find(t => t.name === 'generate_section')).toBeDefined()
  })

  it('drafting phase does NOT have resolve_call', () => {
    const tools = getToolsForPhase('drafting')
    expect(tools.find(t => t.name === 'resolve_call')).toBeUndefined()
  })
})
