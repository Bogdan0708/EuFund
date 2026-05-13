import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import { ValidationError } from '@/lib/ai/agent/services/errors'
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

function makeCtx(): ServiceContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: SESSION_ID,
    requestId: 'req-1',
    now: new Date(),
    allowWrites: true,
    expectedStateVersion: 0,
  }
}

function makeSaveDraftBlock(): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tu_1',
    name: 'save_section_draft',
    input: { sessionId: SESSION_ID, sectionKey: 'obiective', content: 'x', expectedStateVersion: 0 },
  }
}

function makeFreezeBlock(): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tu_freeze',
    name: 'freeze_outline',
    input: { sessionId: SESSION_ID, expectedStateVersion: 0 },
  }
}

function makeStatusBlock(): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tu_status',
    name: 'set_application_status',
    input: { sessionId: SESSION_ID, status: 'completed', expectedStateVersion: 0 },
  }
}

function makeApproveBlock(): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tu_approve',
    name: 'approve_revision',
    input: { sessionId: SESSION_ID, sectionKey: 'obiective', expectedStateVersion: 0 },
  }
}

function makeSelectCallBlock(): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tu_sel',
    name: 'set_selected_call',
    input: { sessionId: SESSION_ID, callId: 'CALL-1', expectedStateVersion: 0 },
  }
}

describe('executor policyCode error mapping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps POLICY_OUTLINE_NOT_FROZEN via save_section_draft', async () => {
    const { saveSectionDraft } = await import('@/lib/ai/agent/services/sections')
    vi.mocked(saveSectionDraft).mockRejectedValueOnce(
      new ValidationError('outlineFrozen', 'Outline must be frozen', 'POLICY_OUTLINE_NOT_FROZEN'),
    )
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(makeSaveDraftBlock(), makeCtx())
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/^POLICY_OUTLINE_NOT_FROZEN:/)
  })

  it('maps POLICY_OUTLINE_ALREADY_FROZEN via set_selected_call', async () => {
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')
    vi.mocked(setSelectedCall).mockRejectedValueOnce(
      new ValidationError('outlineFrozen', 'Outline already frozen', 'POLICY_OUTLINE_ALREADY_FROZEN'),
    )
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(makeSelectCallBlock(), makeCtx())
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/^POLICY_OUTLINE_ALREADY_FROZEN:/)
  })

  it('maps POLICY_NO_CALL_SELECTED via freeze_outline', async () => {
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')
    vi.mocked(freezeOutline).mockRejectedValueOnce(
      new ValidationError('selectedCallId', 'No call selected', 'POLICY_NO_CALL_SELECTED'),
    )
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(makeFreezeBlock(), makeCtx())
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/^POLICY_NO_CALL_SELECTED:/)
  })

  it('maps POLICY_ELIGIBILITY_NOT_PASSED via freeze_outline', async () => {
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')
    vi.mocked(freezeOutline).mockRejectedValueOnce(
      new ValidationError('eligibility', 'Eligibility not passed', 'POLICY_ELIGIBILITY_NOT_PASSED'),
    )
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(makeFreezeBlock(), makeCtx())
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/^POLICY_ELIGIBILITY_NOT_PASSED:/)
  })

  it('maps POLICY_SECTION_WRONG_STATE via approve_revision', async () => {
    const { approveSection } = await import('@/lib/ai/agent/services/sections')
    vi.mocked(approveSection).mockRejectedValueOnce(
      new ValidationError('status', 'Cannot approve from this state', 'POLICY_SECTION_WRONG_STATE'),
    )
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(makeApproveBlock(), makeCtx())
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/^POLICY_SECTION_WRONG_STATE:/)
  })

  it('maps POLICY_SESSION_NOT_ACTIVE via set_application_status', async () => {
    const { setApplicationStatus } = await import('@/lib/ai/agent/services/application')
    vi.mocked(setApplicationStatus).mockRejectedValueOnce(
      new ValidationError('status', 'Session not active', 'POLICY_SESSION_NOT_ACTIVE'),
    )
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(makeStatusBlock(), makeCtx())
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/^POLICY_SESSION_NOT_ACTIVE:/)
  })

  it('maps POLICY_VALIDATION_NOT_PASSED via set_application_status(completed)', async () => {
    const { setApplicationStatus } = await import('@/lib/ai/agent/services/application')
    vi.mocked(setApplicationStatus).mockRejectedValueOnce(
      new ValidationError('validation', 'Validation not passed', 'POLICY_VALIDATION_NOT_PASSED'),
    )
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(makeStatusBlock(), makeCtx())
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/^POLICY_VALIDATION_NOT_PASSED:/)
  })

  it('falls back to VALIDATION:<field> when ValidationError has no policyCode', async () => {
    const { saveSectionDraft } = await import('@/lib/ai/agent/services/sections')
    vi.mocked(saveSectionDraft).mockRejectedValueOnce(new ValidationError('content', 'Content required'))
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const r = await executeManagedTool(makeSaveDraftBlock(), makeCtx())
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/^VALIDATION:content:/)
  })
})
