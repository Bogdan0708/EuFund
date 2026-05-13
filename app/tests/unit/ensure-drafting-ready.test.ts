import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentSession, AgentSection, SectionSpec, EligibilityResult } from '@/lib/ai/agent/types'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

const calls = {
  runEligibilityForSession: vi.fn(),
  freezeOutline: vi.fn(),
}

vi.mock('@/lib/ai/agent/services/application', () => ({
  runEligibilityForSession: (...a: unknown[]) => calls.runEligibilityForSession(...a),
  freezeOutline: (...a: unknown[]) => calls.freezeOutline(...a),
}))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

function spec(id: string, order: number, modelHint: 'light' | 'heavy' = 'light'): SectionSpec {
  return {
    id, title: id, description: '', order, generationOrder: order,
    importance: 'standard', expectedLength: 'medium', dependsOn: [],
    modelHint, mandatory: true, confidence: 0.9,
  }
}

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

const PASS_ELIG: EligibilityResult = {
  results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0,
}

function session(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: SESSION_ID, userId: USER_ID, projectId: null, status: 'active', locale: 'ro',
    selectedCallId: 'C-1', currentPhase: 'structuring',
    blueprint: null, eligibility: null, outline: null,
    warnings: [], planningArtifact: null, outlineFrozen: false,
    messageSummary: null, stateVersion: 0,
    createdAt: new Date(0), updatedAt: new Date(0),
    ...over,
  }
}

function ctx(): ServiceContext {
  return {
    userId: USER_ID,
    sessionId: SESSION_ID,
    requestId: 'req-1',
    now: new Date(),
  }
}

describe('ensureDraftingReady', () => {
  beforeEach(() => {
    calls.runEligibilityForSession.mockReset()
    calls.freezeOutline.mockReset()
  })

  it('returns OUTLINE_NOT_READY when outline is null', async () => {
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(session(), { expectedStateVersion: 0 }, [], ctx())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('OUTLINE_NOT_READY')
  })

  it('returns NO_SECTION_TO_GENERATE when every section row is non-pending', async () => {
    const s = session({ outline: [spec('a', 1)], eligibility: PASS_ELIG, outlineFrozen: true })
    const rows: AgentSection[] = [{
      id: 'r1', sessionId: SESSION_ID, sectionKey: 'a', title: 'A',
      documentOrder: 1, generationOrder: 1, status: 'accepted',
      content: 'x', acceptedContent: 'x', version: 1,
      rejectionReason: null, createdAt: new Date(0), updatedAt: new Date(0),
    } as unknown as AgentSection]
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: 0 }, rows, ctx())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('NO_SECTION_TO_GENERATE')
  })

  it('returns ELIGIBILITY_INPUT_REQUIRED when runEligibilityForSession throws ELIGIBILITY_INPUTS_MISSING', async () => {
    const { ValidationError } = await import('@/lib/ai/agent/services/errors')
    calls.runEligibilityForSession.mockRejectedValueOnce(
      new ValidationError('eligibility', 'inputs missing', 'ELIGIBILITY_INPUTS_MISSING'),
    )
    const s = session({ outline: [spec('a', 1)] })
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: 0 }, [], ctx())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('ELIGIBILITY_INPUT_REQUIRED')
      expect((res as { missing: string[] }).missing).toContain('projectSummary')
    }
  })

  it('returns ELIGIBILITY_FAILED when eligibility has failures', async () => {
    const s = session({
      outline: [spec('a', 1)],
      eligibility: { results: [], score: 30, passCount: 0, failCount: 1, warningCount: 0 },
      outlineFrozen: true,
    })
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: s.stateVersion }, [], ctx())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('ELIGIBILITY_FAILED')
  })

  it('picks first pending section by generationOrder', async () => {
    const s = session({
      outline: [spec('b', 2), spec('a', 1)],
      eligibility: PASS_ELIG,
      outlineFrozen: true,
    })
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: 0 }, [], ctx())
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.sectionSpec.id).toBe('a')
  })

  it('freezes outline when not frozen', async () => {
    calls.freezeOutline.mockResolvedValueOnce({ newStateVersion: 1 })
    const s = session({
      outline: [spec('a', 1)],
      eligibility: PASS_ELIG,
      outlineFrozen: false,
    })
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: 0 }, [], ctx())
    expect(calls.freezeOutline).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.sectionSpec.id).toBe('a')
      expect(res.stateVersion).toBe(1)
    }
  })

  it('runs eligibility when null, advances stateVersion', async () => {
    calls.runEligibilityForSession.mockResolvedValueOnce({
      newStateVersion: 1,
      decision: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
    })
    calls.freezeOutline.mockResolvedValueOnce({ newStateVersion: 2 })
    const s = session({
      outline: [spec('a', 1)],
      eligibility: null,
      outlineFrozen: false,
      planningArtifact: { projectSummary: 'we want X' } as never,
    })
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: 0 }, [], ctx())
    expect(calls.runEligibilityForSession).toHaveBeenCalledTimes(1)
    expect(calls.freezeOutline).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.stateVersion).toBe(2)
  })
})
