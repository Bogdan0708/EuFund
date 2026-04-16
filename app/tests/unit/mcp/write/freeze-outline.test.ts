import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerFreezeOutline, inputShape, inputSchema } from '@/lib/ai/agent/mcp/write/freeze-outline'
import { ConcurrencyError, NotFoundError, ValidationError } from '@/lib/ai/agent/services/errors'
import * as application from '@/lib/ai/agent/services/application'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

vi.mock('@/lib/ai/agent/services/application')

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
  } as unknown as Parameters<typeof registerFreezeOutline>[0]
  registerFreezeOutline(server, ctx)
  if (!captured) throw new Error('server.tool not called')
  return captured
}

const VALID_ARGS = {
  sessionId: '22222222-2222-4222-8222-222222222222',
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

describe('MCP freeze_outline handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exports inputShape and inputSchema', () => {
    expect(inputShape).toBeDefined()
    expect(inputSchema.parse(VALID_ARGS)).toEqual(VALID_ARGS)
  })

  it('returns service result on happy path', async () => {
    vi.mocked(application.freezeOutline).mockResolvedValueOnce({ newStateVersion: 1 })
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ newStateVersion: 1 })
  })

  it('maps ConcurrencyError to CONCURRENCY', async () => {
    vi.mocked(application.freezeOutline).mockRejectedValueOnce(new ConcurrencyError(0, 2))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('CONCURRENCY')
  })

  it('maps NotFoundError to NOT_FOUND', async () => {
    vi.mocked(application.freezeOutline).mockRejectedValueOnce(new NotFoundError('session', 's1'))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('NOT_FOUND')
  })

  it('propagates POLICY_NO_CALL_SELECTED', async () => {
    vi.mocked(application.freezeOutline).mockRejectedValueOnce(
      new ValidationError('selectedCallId', 'No call selected', 'POLICY_NO_CALL_SELECTED'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('POLICY_NO_CALL_SELECTED')
  })

  it('propagates POLICY_ELIGIBILITY_NOT_PASSED', async () => {
    vi.mocked(application.freezeOutline).mockRejectedValueOnce(
      new ValidationError('eligibility', 'Eligibility check not passed', 'POLICY_ELIGIBILITY_NOT_PASSED'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
  })

  it('propagates POLICY_OUTLINE_ALREADY_FROZEN', async () => {
    vi.mocked(application.freezeOutline).mockRejectedValueOnce(
      new ValidationError('outlineFrozen', 'Already frozen', 'POLICY_OUTLINE_ALREADY_FROZEN'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('POLICY_OUTLINE_ALREADY_FROZEN')
  })
})
