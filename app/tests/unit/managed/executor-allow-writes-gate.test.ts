import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import { WRITE_TOOL_NAMES } from '@/lib/ai/agent/managed/tools'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

vi.mock('@/lib/ai/agent/services/sections', () => ({
  saveSectionDraft: vi.fn(),
  approveSection: vi.fn(),
  rollbackSection: vi.fn(),
  markSectionStale: vi.fn(),
  rejectSection: vi.fn(),
  listSections: vi.fn(),
  getSection: vi.fn(),
  validateSection: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/application', () => ({
  setApplicationStatus: vi.fn(),
  setSelectedCall: vi.fn(),
  freezeOutline: vi.fn(),
  getApplicationState: vi.fn(),
  getValidationReport: vi.fn(),
  validateApplication: vi.fn(),
  checkMissingAnnexes: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn(),
  retrieveEvidence: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: vi.fn() }))
vi.mock('@/lib/ai/agent/services/projects', () => ({
  getProjectSummary: vi.fn(),
  listUploadedDocuments: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/eligibility', () => ({
  runEligibility: vi.fn(),
  scoreFit: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

function makeBlock(name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: 'tool_use', id: `tu_${name}`, name, input }
}

function makeCtx(allowWrites?: boolean): ServiceContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    requestId: 'req-1',
    now: new Date(),
    allowWrites,
  }
}

function validInputFor(name: string): Record<string, unknown> {
  const base = {
    sessionId: '22222222-2222-4222-8222-222222222222',
    expectedStateVersion: 0,
  }
  switch (name) {
    case 'save_section_draft':
      return { ...base, sectionKey: 'obiective', content: 'x' }
    case 'approve_revision':
    case 'mark_section_stale':
      return { ...base, sectionKey: 'obiective' }
    case 'rollback_section':
      return { ...base, sectionKey: 'obiective', targetVersion: 1 }
    case 'reject_section':
      return { ...base, sectionKey: 'obiective', reason: 'does not align' }
    case 'set_application_status':
      return { ...base, status: 'paused' }
    case 'set_selected_call':
      return { ...base, callId: 'CALL-1' }
    case 'freeze_outline':
      return base
    default:
      return base
  }
}

describe('executor allowWrites gate', () => {
  beforeEach(() => vi.clearAllMocks())

  for (const name of WRITE_TOOL_NAMES) {
    it(`blocks ${name} when ctx.allowWrites is false`, async () => {
      const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
      const result = await executeManagedTool(makeBlock(name, validInputFor(name)), makeCtx(false))
      expect(result.isError).toBe(true)
      expect(result.content).toMatch(/disabled for your account|rollout gate/i)
    })

    it(`blocks ${name} when ctx.allowWrites is undefined`, async () => {
      const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
      const result = await executeManagedTool(makeBlock(name, validInputFor(name)), makeCtx())
      expect(result.isError).toBe(true)
      expect(result.content).toMatch(/disabled for your account|rollout gate/i)
    })
  }

  it('does NOT block read tools when ctx.allowWrites is false', async () => {
    const { searchCalls } = await import('@/lib/ai/agent/services/evidence')
    vi.mocked(searchCalls).mockResolvedValueOnce({ matches: [] } as never)
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const result = await executeManagedTool(
      makeBlock('search_calls', { query: 'x' }),
      makeCtx(false),
    )
    expect(result.isError).toBe(false)
  })
})
