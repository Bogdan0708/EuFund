// Regression: every V3 phase needs a tool that can transition it forward.
// The original 2026-05-11 bug was extract_structure being gated to
// `structuring` only — meaning research had no path out. A second instance
// of the same bug was found in the audit follow-up: validate_application
// transitioned drafting → review but was only callable from review itself.
// This test pins the contract so the next phase-transitioning tool added
// against this pattern fails CI loudly.

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(() => ({ search: vi.fn().mockResolvedValue([]) })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

// Self-register tools that emit forward-phase transitions
import '@/lib/ai/agent/tools/extract-structure'
import '@/lib/ai/agent/tools/validate-application'

import { getToolsForPhase } from '@/lib/ai/agent/tools/registry'

describe('V3 phase-transition bridges', () => {
  it('research can call extract_structure (research → structuring)', () => {
    const tools = getToolsForPhase('research')
    expect(tools.find(t => t.name === 'extract_structure')).toBeDefined()
  })

  it('drafting can call validate_application (drafting → review)', () => {
    const tools = getToolsForPhase('drafting')
    expect(tools.find(t => t.name === 'validate_application')).toBeDefined()
  })

  it('extract_structure remains in structuring (no regression)', () => {
    const tools = getToolsForPhase('structuring')
    expect(tools.find(t => t.name === 'extract_structure')).toBeDefined()
  })

  it('validate_application remains in review (no regression)', () => {
    const tools = getToolsForPhase('review')
    expect(tools.find(t => t.name === 'validate_application')).toBeDefined()
  })
})
