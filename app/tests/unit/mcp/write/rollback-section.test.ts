import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerRollbackSection, inputShape, inputSchema } from '@/lib/ai/agent/mcp/write/rollback-section'
import { ConcurrencyError, NotFoundError, ValidationError } from '@/lib/ai/agent/services/errors'
import * as sections from '@/lib/ai/agent/services/sections'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

vi.mock('@/lib/ai/agent/services/sections')

type ToolCallback = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>
  isError?: boolean
}>

function registerAndCapture(ctx: ServiceContext): ToolCallback {
  let captured: ToolCallback | null = null
  const server = {
    tool: (_name: string, _desc: string, _shape: unknown, cb: ToolCallback) => {
      captured = cb
    },
  } as unknown as Parameters<typeof registerRollbackSection>[0]
  registerRollbackSection(server, ctx)
  if (!captured) throw new Error('server.tool not called')
  return captured
}

const VALID_ARGS = {
  sectionKey: 'obiective',
  targetVersion: 1,
  expectedStateVersion: 0,
}

function makeCtx(): ServiceContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    requestId: 'req-1',
    now: new Date(),
  }
}

describe('MCP rollback_section handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exports inputShape and inputSchema', () => {
    expect(inputShape).toBeDefined()
    expect(inputSchema.parse(VALID_ARGS)).toEqual(VALID_ARGS)
  })

  it('returns service result on happy path', async () => {
    vi.mocked(sections.rollbackSection).mockResolvedValueOnce({
      content: 'restored',
      restoredVersion: 1,
      newStateVersion: 1,
    } as never)
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text).restoredVersion).toBe(1)
  })

  it('maps ConcurrencyError to CONCURRENCY', async () => {
    vi.mocked(sections.rollbackSection).mockRejectedValueOnce(new ConcurrencyError(0, 3))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('CONCURRENCY')
  })

  it('maps NotFoundError to NOT_FOUND', async () => {
    vi.mocked(sections.rollbackSection).mockRejectedValueOnce(new NotFoundError('version', '999'))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('NOT_FOUND')
  })

  it('propagates policyCode from ValidationError', async () => {
    vi.mocked(sections.rollbackSection).mockRejectedValueOnce(
      new ValidationError('outlineFrozen', 'Outline must be frozen', 'POLICY_OUTLINE_NOT_FROZEN'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('POLICY_OUTLINE_NOT_FROZEN')
  })

  it('falls back to VALIDATION:<field> when no policyCode', async () => {
    vi.mocked(sections.rollbackSection).mockRejectedValueOnce(
      new ValidationError('targetVersion', 'must be int'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('VALIDATION:targetVersion')
  })
})
