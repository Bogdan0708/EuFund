import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import {
  NotFoundError,
  AuthorizationError,
} from '@/lib/ai/agent/services/errors'

const mockCtx = {
  userId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-1',
  now: new Date(),
}

vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn(),
  retrieveEvidence: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({
  lookupBlueprint: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/application', () => ({
  getApplicationState: vi.fn(),
  getValidationReport: vi.fn(),
  validateApplication: vi.fn(),
  checkMissingAnnexes: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/sections', () => ({
  listSections: vi.fn(),
  getSection: vi.fn(),
  validateSection: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/projects', () => ({
  getProjectSummary: vi.fn(),
  listUploadedDocuments: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/eligibility', () => ({
  runEligibility: vi.fn(),
  scoreFit: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}))

function makeBlock(name: string, input: unknown = {}): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tu_1',
    name,
    input,
  }
}

describe('executeManagedTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('happy path: search_calls → service → serialized JSON', async () => {
    const { searchCalls } = await import('@/lib/ai/agent/services/evidence')
    ;(searchCalls as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [
        {
          callId: 'C1',
          title: 'T',
          program: 'PNRR',
          score: 0.9,
          snippet: 's',
        },
      ],
    })

    const { executeManagedTool } = await import(
      '@/lib/ai/agent/managed/executor'
    )
    const result = await executeManagedTool(
      makeBlock('search_calls', { query: 'solar panels' }),
      mockCtx,
    )

    expect(result.isError).toBe(false)
    expect(result.toolName).toBe('search_calls')
    const parsed = JSON.parse(result.content)
    expect(parsed.matches).toBeDefined()
  })

  it('blocks write tool with Phase 2 message', async () => {
    const { executeManagedTool } = await import(
      '@/lib/ai/agent/managed/executor'
    )
    const result = await executeManagedTool(
      makeBlock('save_section_draft'),
      mockCtx,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Phase 2')
    expect(result.content).toMatch(/read and evaluate|read-only/i)
  })

  it('blocks unknown tool name', async () => {
    const { executeManagedTool } = await import(
      '@/lib/ai/agent/managed/executor'
    )
    const result = await executeManagedTool(
      makeBlock('made_up_tool'),
      mockCtx,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown tool')
  })

  it('maps NotFoundError to isError with NOT_FOUND prefix', async () => {
    const { lookupBlueprint } = await import(
      '@/lib/ai/agent/services/blueprint'
    )
    ;(lookupBlueprint as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundError('call', 'CALL-X'),
    )

    const { executeManagedTool } = await import(
      '@/lib/ai/agent/managed/executor'
    )
    const result = await executeManagedTool(
      makeBlock('get_call_blueprint', { callId: 'CALL-X' }),
      mockCtx,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/^NOT_FOUND:/)
  })

  it('maps AuthorizationError with safe phrasing', async () => {
    const { getApplicationState } = await import(
      '@/lib/ai/agent/services/application'
    )
    ;(
      getApplicationState as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new AuthorizationError())

    const { executeManagedTool } = await import(
      '@/lib/ai/agent/managed/executor'
    )
    const result = await executeManagedTool(
      makeBlock('get_application_state', {
        sessionId: '22222222-2222-4222-8222-222222222222',
      }),
      mockCtx,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/^AUTHORIZATION:/)
    expect(result.content).toContain('Access denied')
  })

  it('maps unexpected errors to safe Internal tool error', async () => {
    const { searchCalls } = await import('@/lib/ai/agent/services/evidence')
    ;(searchCalls as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('some internal detail with stack trace'),
    )

    const { executeManagedTool } = await import(
      '@/lib/ai/agent/managed/executor'
    )
    const result = await executeManagedTool(
      makeBlock('search_calls', { query: 'x' }),
      mockCtx,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toBe('Internal tool error')
    expect(result.content).not.toContain('stack trace')
  })

  it('records latencyMs', async () => {
    const { searchCalls } = await import('@/lib/ai/agent/services/evidence')
    ;(searchCalls as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [],
    })

    const { executeManagedTool } = await import(
      '@/lib/ai/agent/managed/executor'
    )
    const result = await executeManagedTool(
      makeBlock('search_calls', { query: 'x' }),
      mockCtx,
    )

    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
})
