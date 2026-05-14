import { describe, it, expect, beforeAll } from 'vitest'
import { trimToChatSurface } from '@/lib/ai/agent/runtime'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('V3 trimToChatSurface', () => {
  beforeAll(async () => {
    // Tool modules self-register on import.
    await import('@/lib/ai/agent/tools')
  })

  it('keeps all read-category tools', () => {
    const trimmed = trimToChatSurface(getToolRegistry())
    const readNames = getToolRegistry()
      .filter((t) => t.category === 'read')
      .map((t) => t.name)
    for (const n of readNames) {
      expect(trimmed.some((t) => t.name === n)).toBe(true)
    }
    // Sanity-check the canonical V3 reads
    const names = new Set(trimmed.map((t) => t.name))
    expect(names.has('search_calls')).toBe(true)
    expect(names.has('get_call_blueprint')).toBe(true)
    expect(names.has('retrieve_call_evidence')).toBe(true)
  })

  it('keeps rule-tools (decision tools that act read-only in trimmed mode)', () => {
    const trimmed = trimToChatSurface(getToolRegistry())
    const names = new Set(trimmed.map((t) => t.name))
    expect(names.has('run_eligibility')).toBe(true)
    expect(names.has('validate_section')).toBe(true)
    expect(names.has('validate_application')).toBe(true)
  })

  it('removes `generate_section` — section authoring goes through /sections/generate (PR 5)', () => {
    const trimmed = trimToChatSurface(getToolRegistry())
    const names = new Set(trimmed.map((t) => t.name))
    expect(names.has('generate_section')).toBe(false)
  })

  it('removes navigation/decision writes that should go through REST actions', () => {
    const trimmed = trimToChatSurface(getToolRegistry())
    const names = new Set(trimmed.map((t) => t.name))
    expect(names.has('extract_structure')).toBe(false)
    expect(names.has('resolve_call')).toBe(false)
    expect(names.has('regenerate_section')).toBe(false)
  })

  it('is a pure filter — returns a subset of the input list (no synthesised names)', () => {
    const all = getToolRegistry()
    const trimmed = trimToChatSurface(all)
    const allNames = new Set(all.map((t) => t.name))
    for (const t of trimmed) {
      expect(allNames.has(t.name)).toBe(true)
    }
    // No duplicates added
    const trimmedNames = trimmed.map((t) => t.name)
    expect(new Set(trimmedNames).size).toBe(trimmedNames.length)
  })
})
