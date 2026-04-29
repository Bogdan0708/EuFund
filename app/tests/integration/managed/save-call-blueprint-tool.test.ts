import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'

vi.mock('@/lib/db', () => {
  const updateCalls: unknown[] = []
  const mockDb = {
    update: vi.fn(() => ({
      set: vi.fn((v: unknown) => {
        const last = updateCalls[updateCalls.length - 1] as Record<string, unknown> | undefined
        if (last) last.set = v
        else updateCalls.push({ set: v })
        return {
          where: vi.fn((w: unknown) => {
            const lastEntry = updateCalls[updateCalls.length - 1] as Record<string, unknown> | undefined
            if (lastEntry) lastEntry.where = w
            return Promise.resolve(undefined)
          }),
        }
      }),
    })),
    __updateCalls: updateCalls,
  }
  return { db: mockDb }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', currentPhase: 'current_phase', selectedCallId: 'selected_call_id', stateVersion: 'state_version' },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
  and: (...args: unknown[]) => ({ kind: 'and', args }),
  sql: (parts: TemplateStringsArray, ..._values: unknown[]) => ({ kind: 'sql', parts: parts.join('?') }),
}))

vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

vi.mock('@/lib/ai/agent/services/blueprint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/agent/services/blueprint')>()
  return {
    ...actual,
    saveCallBlueprint: vi.fn().mockResolvedValue({
      callId: 'CALL-1', version: 1, contentHash: 'hash', persistedAt: new Date(),
    }),
  }
})

import { executeManagedTool } from '@/lib/ai/agent/managed/executor'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

describe('save_call_blueprint executor case', () => {
  beforeEach(() => vi.clearAllMocks())

  const ctx: ServiceContext = {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    requestId: 'req-1',
    now: new Date('2026-04-29T00:00:00Z'),
    allowWrites: true,
  }

  const block: ToolUseBlock = {
    type: 'tool_use',
    id: 'tu_1',
    name: 'save_call_blueprint',
    input: {
      callId: 'CALL-1',
      blueprint: {
        program: 'PNRR',
        requiredSections: [{ title: 'Obiective', description: 'Project goals' }],
        mandatoryAnnexes: ['Anexa 1'],
        eligibilityCriteria: ['Romanian SME'],
        structureConfidence: 0.5,
      },
    },
  }

  it('calls saveCallBlueprint with full normalized CallBlueprint', async () => {
    const { saveCallBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    const result = await executeManagedTool(block, ctx)

    expect(result.isError).toBe(false)
    expect(saveCallBlueprint).toHaveBeenCalledTimes(1)
    const [, callId, blueprint] = vi.mocked(saveCallBlueprint).mock.calls[0]
    expect(callId).toBe('CALL-1')
    expect(blueprint.program).toBe('PNRR')
    expect(blueprint.normalized.requiredSections).toEqual([{ title: 'Obiective', description: 'Project goals' }])
    expect(blueprint.structureConfidence).toBe(0.5)
  })

  it('updates agent_sessions with blueprint, currentPhase=structuring, stateVersion bump', async () => {
    await executeManagedTool(block, ctx)

    const { db } = await import('@/lib/db') as unknown as { db: { __updateCalls: Array<Record<string, unknown>> } }
    expect(db.__updateCalls.length).toBeGreaterThanOrEqual(1)
    const last = db.__updateCalls[db.__updateCalls.length - 1]
    const set = last.set as Record<string, unknown>
    expect(set.currentPhase).toBe('structuring')
    expect(set.blueprint).toBeDefined()
    // stateVersion is set to a sql-tagged increment expression
    expect((set.stateVersion as { kind: string })?.kind).toBe('sql')
    expect(set.updatedAt).toBeInstanceOf(Date)
  })

  it('returns isError when allowWrites is false (rollout gate)', async () => {
    const ctxNoWrites = { ...ctx, allowWrites: false }
    const result = await executeManagedTool(block, ctxNoWrites)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Managed write tools are disabled')
  })
})
