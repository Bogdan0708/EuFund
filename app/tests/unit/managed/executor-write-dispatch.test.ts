import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
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
vi.mock('@/lib/ai/agent/services/evidence', () => ({ searchCalls: vi.fn(), retrieveEvidence: vi.fn() }))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: vi.fn() }))
vi.mock('@/lib/ai/agent/services/projects', () => ({ getProjectSummary: vi.fn(), listUploadedDocuments: vi.fn() }))
vi.mock('@/lib/ai/agent/services/eligibility', () => ({ runEligibility: vi.fn(), scoreFit: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

const SESSION_ID = '22222222-2222-4222-8222-222222222222'

function makeBlock(name: string, input: Record<string, unknown>): ToolUseBlock {
  return { type: 'tool_use', id: `tu_${name}`, name, input }
}

function makeCtx(): ServiceContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: SESSION_ID,
    requestId: 'req-1',
    now: new Date(),
    allowWrites: true,
  }
}

describe('executor write dispatch happy paths', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dispatches save_section_draft', async () => {
    const sections = await import('@/lib/ai/agent/services/sections')
    vi.mocked(sections.saveSectionDraft).mockResolvedValueOnce({
      sectionId: 's1',
      versionNumber: 1,
      newStateVersion: 1,
    } as never)
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(
      makeBlock('save_section_draft', { sessionId: SESSION_ID, sectionKey: 'obiective', content: 'x', expectedStateVersion: 0 }),
      makeCtx(),
    )
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content)).toEqual({ sectionId: 's1', versionNumber: 1, newStateVersion: 1 })
    expect(sections.saveSectionDraft).toHaveBeenCalledTimes(1)
  })

  it('dispatches approve_revision', async () => {
    const sections = await import('@/lib/ai/agent/services/sections')
    vi.mocked(sections.approveSection).mockResolvedValueOnce({ newStateVersion: 1 } as never)
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(
      makeBlock('approve_revision', { sessionId: SESSION_ID, sectionKey: 'obiective', expectedStateVersion: 0 }),
      makeCtx(),
    )
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content)).toEqual({ newStateVersion: 1 })
  })

  it('dispatches rollback_section', async () => {
    const sections = await import('@/lib/ai/agent/services/sections')
    vi.mocked(sections.rollbackSection).mockResolvedValueOnce({
      content: 'restored',
      restoredVersion: 1,
      newStateVersion: 1,
    } as never)
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(
      makeBlock('rollback_section', { sessionId: SESSION_ID, sectionKey: 'obiective', targetVersion: 1, expectedStateVersion: 0 }),
      makeCtx(),
    )
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content).restoredVersion).toBe(1)
  })

  it('dispatches mark_section_stale', async () => {
    const sections = await import('@/lib/ai/agent/services/sections')
    vi.mocked(sections.markSectionStale).mockResolvedValueOnce({ newStateVersion: 1 } as never)
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(
      makeBlock('mark_section_stale', { sessionId: SESSION_ID, sectionKey: 'obiective', expectedStateVersion: 0 }),
      makeCtx(),
    )
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content)).toEqual({ newStateVersion: 1 })
  })

  it('dispatches reject_section', async () => {
    const sections = await import('@/lib/ai/agent/services/sections')
    vi.mocked(sections.rejectSection).mockResolvedValueOnce({ newStateVersion: 1 } as never)
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(
      makeBlock('reject_section', { sessionId: SESSION_ID, sectionKey: 'obiective', reason: 'bad', expectedStateVersion: 0 }),
      makeCtx(),
    )
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content)).toEqual({ newStateVersion: 1 })
  })

  it('dispatches set_application_status', async () => {
    const application = await import('@/lib/ai/agent/services/application')
    vi.mocked(application.setApplicationStatus).mockResolvedValueOnce({ newStateVersion: 1 } as never)
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(
      makeBlock('set_application_status', { sessionId: SESSION_ID, status: 'paused', expectedStateVersion: 0 }),
      makeCtx(),
    )
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content)).toEqual({ newStateVersion: 1 })
  })

  it('dispatches set_selected_call', async () => {
    const application = await import('@/lib/ai/agent/services/application')
    vi.mocked(application.setSelectedCall).mockResolvedValueOnce({ newStateVersion: 1 } as never)
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(
      makeBlock('set_selected_call', { sessionId: SESSION_ID, callId: 'CALL-1', expectedStateVersion: 0 }),
      makeCtx(),
    )
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content)).toEqual({ newStateVersion: 1 })
  })

  it('dispatches freeze_outline', async () => {
    const application = await import('@/lib/ai/agent/services/application')
    vi.mocked(application.freezeOutline).mockResolvedValueOnce({ newStateVersion: 1 } as never)
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(
      makeBlock('freeze_outline', { sessionId: SESSION_ID, expectedStateVersion: 0 }),
      makeCtx(),
    )
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content)).toEqual({ newStateVersion: 1 })
  })
})
