import { describe, it, expect, vi } from 'vitest'
import { formatToolError } from '@/lib/ai/agent/format-tool-error'
import enMessages from '@/messages/en.json'
import roMessages from '@/messages/ro.json'

// Load the ACTUAL translation maps from messages/{en,ro}.json so a typo or
// missing key in the JSON would break this test. Duplicating local copies
// would let drift go undetected.
const EN = (enMessages as { agent: { toolErrors: Record<string, string> } }).agent.toolErrors
const RO = (roMessages as { agent: { toolErrors: Record<string, string> } }).agent.toolErrors

// Build a translator stub that mimics next-intl's t(key, params) shape.
function makeT(messages: Record<string, string>) {
  return (key: string, params?: Record<string, string>) => {
    const tpl = messages[key]
    if (tpl == null) throw new Error(`missing key: ${key}`)
    if (!params) return tpl
    return tpl.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`)
  }
}

describe('formatToolError', () => {
  describe.each([
    ['en', makeT(EN), EN],
    ['ro', makeT(RO), RO],
  ])('locale=%s', (_locale, t, M) => {
    it('PARALLEL_WRITE_BLOCKED prefix', () => {
      const out = formatToolError(
        'save_section_draft',
        'PARALLEL_WRITE_BLOCKED: Only one write tool call is allowed per assistant message. ...',
        t,
      )
      expect(out).toBe(M.PARALLEL_WRITE_BLOCKED)
    })

    it('Tool timed out exact match', () => {
      const out = formatToolError('search_calls', 'Tool timed out after 15s', t)
      expect(out).toBe(M.TOOL_TIMEOUT.replace('{tool}', 'search_calls'))
    })

    it('NOT_FOUND prefix', () => {
      const out = formatToolError('get_section', 'NOT_FOUND: section foo', t)
      expect(out).toBe(M.NOT_FOUND.replace('{tool}', 'get_section'))
    })

    it('AUTHORIZATION prefix', () => {
      const out = formatToolError('save_section_draft', 'AUTHORIZATION: Access denied to requested session', t)
      expect(out).toBe(M.AUTHORIZATION.replace('{tool}', 'save_section_draft'))
    })

    it('POLICY_ prefix interpolates code only', () => {
      const out = formatToolError(
        'freeze_outline',
        'POLICY_OUTLINE_NOT_FROZEN: outline must be frozen',
        t,
      )
      expect(out).toBe(
        M.POLICY_PREFIX.replace('{tool}', 'freeze_outline').replace('{code}', 'POLICY_OUTLINE_NOT_FROZEN'),
      )
    })

    it('VALIDATION: prefix', () => {
      const out = formatToolError('save_section_draft', 'VALIDATION:sectionKey: invalid', t)
      expect(out).toBe(M.VALIDATION_PREFIX.replace('{tool}', 'save_section_draft'))
    })

    it('CONCURRENCY prefix', () => {
      const out = formatToolError('approve_section', 'CONCURRENCY: state version mismatch', t)
      expect(out).toBe(M.CONCURRENCY.replace('{tool}', 'approve_section'))
    })

    it('EXTERNAL_DEPENDENCY prefix', () => {
      const out = formatToolError('search_calls', 'EXTERNAL_DEPENDENCY: VectorStore unavailable', t)
      expect(out).toBe(M.EXTERNAL_DEPENDENCY.replace('{tool}', 'search_calls'))
    })

    it('Internal tool error exact match', () => {
      const out = formatToolError('any_tool', 'Internal tool error', t)
      expect(out).toBe(M.INTERNAL.replace('{tool}', 'any_tool'))
    })

    it('unknown summary falls back to GENERIC', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const prevEnv = process.env.NODE_ENV
      // Cast away readonly TS type for env in the test; runtime allows assignment.
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
      try {
        const out = formatToolError('any_tool', 'completely unknown error string', t)
        expect(out).toBe(M.GENERIC.replace('{tool}', 'any_tool'))
        expect(warn).toHaveBeenCalledWith('[tool error]', 'any_tool', 'completely unknown error string')
      } finally {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = prevEnv
        warn.mockRestore()
      }
    })

    it('GENERIC fallback does not console.warn in production', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const prevEnv = process.env.NODE_ENV
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
      try {
        formatToolError('any_tool', 'unknown', t)
        expect(warn).not.toHaveBeenCalled()
      } finally {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = prevEnv
        warn.mockRestore()
      }
    })
  })

  it('Romanian POLICY_ output never contains raw English service prose', () => {
    // Regression guard: the formatter must extract only the stable code,
    // never pass the full `summary` (which contains English error prose
    // like "outline must be frozen") into the localized template.
    const out = formatToolError(
      'freeze_outline',
      'POLICY_OUTLINE_NOT_FROZEN: outline must be frozen',
      makeT(RO),
    )
    expect(out).not.toMatch(/outline must be frozen/)
    expect(out).toContain('POLICY_OUTLINE_NOT_FROZEN')
  })
})
