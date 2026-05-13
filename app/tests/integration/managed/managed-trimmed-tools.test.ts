import { describe, it, expect } from 'vitest'
import {
  getManagedTools,
  READ_TOOL_NAMES,
  RULE_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  CHAT_WRITE_TOOL_NAMES,
} from '@/lib/ai/agent/managed/tools'

describe('getManagedTools — chat trimmed surface', () => {
  it('returns exactly READ + RULE + CHAT_WRITE tools when allowWrites=true and trimmed=true', () => {
    const tools = getManagedTools(true, true)
    expect(tools.length).toBe(
      READ_TOOL_NAMES.size + RULE_TOOL_NAMES.size + CHAT_WRITE_TOOL_NAMES.size,
    )

    const names = new Set(tools.map((t) => t.name))
    for (const n of READ_TOOL_NAMES) {
      expect(names.has(n)).toBe(true)
    }
    for (const n of RULE_TOOL_NAMES) {
      expect(names.has(n)).toBe(true)
    }
    for (const n of CHAT_WRITE_TOOL_NAMES) {
      expect(names.has(n)).toBe(true)
    }
  })

  it('excludes every navigation write when trimmed=true', () => {
    const tools = getManagedTools(true, true)
    const names = new Set(tools.map((t) => t.name))

    // CHAT_WRITE is the only allowed write
    for (const w of WRITE_TOOL_NAMES) {
      if (CHAT_WRITE_TOOL_NAMES.has(w)) continue
      expect(names.has(w)).toBe(false)
    }

    // Spot-check the named exclusions called out in the PR 4 design
    expect(names.has('save_call_blueprint')).toBe(false)
    expect(names.has('freeze_outline')).toBe(false)
    expect(names.has('set_selected_call')).toBe(false)
    expect(names.has('approve_revision')).toBe(false)
    expect(names.has('reject_section')).toBe(false)
    expect(names.has('rollback_section')).toBe(false)
    expect(names.has('mark_section_stale')).toBe(false)
    expect(names.has('set_application_status')).toBe(false)
  })

  it('save_section_draft has a content-only input schema in trimmed mode', () => {
    const tools = getManagedTools(true, true)
    const tool = tools.find((t) => t.name === 'save_section_draft')
    expect(tool).toBeDefined()
    const schema = tool!.input_schema as {
      type: string
      properties: Record<string, unknown>
      required: string[]
      additionalProperties: boolean
    }
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties)).toEqual(['content'])
    expect(schema.required).toEqual(['content'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('returns the full surface when allowWrites=true and trimmed=false (back-compat)', () => {
    const tools = getManagedTools(true, false)
    const names = new Set(tools.map((t) => t.name))
    // All writes still present in legacy mode
    for (const w of WRITE_TOOL_NAMES) {
      expect(names.has(w)).toBe(true)
    }
    expect(names.has('save_call_blueprint')).toBe(true)
    expect(names.has('freeze_outline')).toBe(true)
  })

  it('returns reads + rules only when allowWrites=false (regardless of trimmed)', () => {
    for (const trimmed of [false, true]) {
      const tools = getManagedTools(false, trimmed)
      const names = new Set(tools.map((t) => t.name))
      for (const r of READ_TOOL_NAMES) expect(names.has(r)).toBe(true)
      for (const r of RULE_TOOL_NAMES) expect(names.has(r)).toBe(true)
      for (const w of WRITE_TOOL_NAMES) expect(names.has(w)).toBe(false)
    }
  })
})
