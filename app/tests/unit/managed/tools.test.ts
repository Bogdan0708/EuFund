import { describe, it, expect } from 'vitest'
import { MANAGED_READ_ONLY_TOOLS, MANAGED_TOOL_NAMES } from '@/lib/ai/agent/managed/tools'

describe('MANAGED_READ_ONLY_TOOLS', () => {
  it('contains exactly 14 tools (9 read + 5 rules)', () => {
    expect(MANAGED_READ_ONLY_TOOLS).toHaveLength(14)
  })

  it('each tool has name, description, and input_schema', () => {
    for (const tool of MANAGED_READ_ONLY_TOOLS) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(tool.description!.length).toBeGreaterThan(0)
      expect(tool.input_schema).toBeDefined()
      expect((tool.input_schema as { type?: string }).type).toBe('object')
    }
  })

  it('MANAGED_TOOL_NAMES is a Set of all tool names', () => {
    expect(MANAGED_TOOL_NAMES.size).toBe(14)
    for (const tool of MANAGED_READ_ONLY_TOOLS) {
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

  it('does NOT include any write tools', () => {
    const writeTools = [
      'save_section_draft', 'approve_revision', 'rollback_section',
      'save_call_blueprint', 'set_application_status', 'create_export_snapshot',
    ]
    for (const name of writeTools) {
      expect(MANAGED_TOOL_NAMES.has(name)).toBe(false)
    }
  })
})
