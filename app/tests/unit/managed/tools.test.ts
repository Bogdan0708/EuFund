import { describe, it, expect } from 'vitest'
import {
  MANAGED_TOOLS,
  MANAGED_TOOL_NAMES,
  READ_TOOL_NAMES,
  RULE_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  PHASE_4_BLOCKED_TOOL_NAMES,
} from '@/lib/ai/agent/managed/tools'

describe('MANAGED_TOOLS', () => {
  it('contains exactly 22 tools (9 read + 5 rules + 8 write)', () => {
    expect(MANAGED_TOOLS).toHaveLength(22)
  })

  it('each tool has name, description, and input_schema', () => {
    for (const tool of MANAGED_TOOLS) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(tool.description!.length).toBeGreaterThan(0)
      expect(tool.input_schema).toBeDefined()
      expect((tool.input_schema as { type?: string }).type).toBe('object')
    }
  })

  it('MANAGED_TOOL_NAMES is a Set of all tool names', () => {
    expect(MANAGED_TOOL_NAMES.size).toBe(22)
    for (const tool of MANAGED_TOOLS) {
      expect(MANAGED_TOOL_NAMES.has(tool.name)).toBe(true)
    }
  })

  it('includes all 9 read tools', () => {
    const expected = [
      'search_calls', 'get_call_blueprint', 'retrieve_evidence',
      'get_application_state', 'list_sections', 'get_section',
      'get_validation_report', 'get_project_summary', 'list_uploaded_documents',
    ]
    for (const name of expected) {
      expect(MANAGED_TOOL_NAMES.has(name)).toBe(true)
    }
  })

  it('includes all 5 rules tools', () => {
    const expected = [
      'run_eligibility', 'score_fit', 'validate_section',
      'validate_application', 'check_missing_annexes',
    ]
    for (const name of expected) {
      expect(MANAGED_TOOL_NAMES.has(name)).toBe(true)
    }
  })

  it('includes all 8 write tools', () => {
    const writeNames = [
      'save_section_draft', 'approve_revision', 'rollback_section',
      'set_application_status', 'set_selected_call', 'freeze_outline',
      'mark_section_stale', 'reject_section',
    ]
    const names = new Set(MANAGED_TOOLS.map((t) => t.name))
    for (const name of writeNames) {
      expect(names.has(name), `missing ${name}`).toBe(true)
    }
  })

  it('write tool descriptions include the confirmation rule', () => {
    const writeNames = [
      'save_section_draft', 'approve_revision', 'rollback_section',
      'set_application_status', 'set_selected_call', 'freeze_outline',
      'mark_section_stale', 'reject_section',
    ]
    for (const name of writeNames) {
      const tool = MANAGED_TOOLS.find((t) => t.name === name)
      expect(tool, `${name} not found`).toBeDefined()
      expect(tool!.description, `${name} description`).toMatch(
        /explicit user confirmation|structured UI action confirmation/i,
      )
    }
  })

  it('Phase 4 write tools are NOT exposed', () => {
    const phase4 = ['create_export_snapshot', 'save_call_blueprint']
    for (const name of phase4) {
      expect(MANAGED_TOOL_NAMES.has(name)).toBe(false)
    }
  })
})

describe('tool name sets', () => {
  it('READ_TOOL_NAMES has 9 entries', () => {
    expect(READ_TOOL_NAMES.size).toBe(9)
  })

  it('RULE_TOOL_NAMES has 5 entries', () => {
    expect(RULE_TOOL_NAMES.size).toBe(5)
  })

  it('WRITE_TOOL_NAMES has 8 entries', () => {
    expect(WRITE_TOOL_NAMES.size).toBe(8)
  })

  it('PHASE_4_BLOCKED_TOOL_NAMES has 2 entries (create_export_snapshot, save_call_blueprint)', () => {
    expect(PHASE_4_BLOCKED_TOOL_NAMES.has('create_export_snapshot')).toBe(true)
    expect(PHASE_4_BLOCKED_TOOL_NAMES.has('save_call_blueprint')).toBe(true)
    expect(PHASE_4_BLOCKED_TOOL_NAMES.size).toBe(2)
  })

  it('READ, RULE, and WRITE sets are disjoint', () => {
    for (const r of READ_TOOL_NAMES) {
      expect(RULE_TOOL_NAMES.has(r), `${r} in both READ and RULE`).toBe(false)
      expect(WRITE_TOOL_NAMES.has(r), `${r} in both READ and WRITE`).toBe(false)
    }
    for (const r of RULE_TOOL_NAMES) {
      expect(WRITE_TOOL_NAMES.has(r), `${r} in both RULE and WRITE`).toBe(false)
    }
  })

  it('MANAGED_TOOL_NAMES is the union of READ + RULE + WRITE (22)', () => {
    const expected = new Set([
      ...READ_TOOL_NAMES,
      ...RULE_TOOL_NAMES,
      ...WRITE_TOOL_NAMES,
    ])
    expect(new Set(MANAGED_TOOL_NAMES)).toEqual(expected)
    expect(MANAGED_TOOL_NAMES.size).toBe(22)
  })

  it('PHASE_4_BLOCKED_TOOL_NAMES is disjoint from MANAGED_TOOL_NAMES', () => {
    for (const name of PHASE_4_BLOCKED_TOOL_NAMES) {
      expect(MANAGED_TOOL_NAMES.has(name), `${name} leaked into MANAGED_TOOL_NAMES`).toBe(false)
    }
  })
})
