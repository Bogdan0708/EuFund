import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerSetApplicationStatus, inputShape, inputSchema } from '@/lib/ai/agent/mcp/write/set-application-status'
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
  } as unknown as Parameters<typeof registerSetApplicationStatus>[0]
  registerSetApplicationStatus(server, ctx)
  if (!captured) throw new Error('server.tool not called')
  return captured
}

const VALID_ARGS = {
  status: 'paused' as const,
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

describe('MCP set_application_status handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exports inputShape and inputSchema', () => {
    expect(inputShape).toBeDefined()
    expect(inputSchema.parse(VALID_ARGS)).toEqual(VALID_ARGS)
  })

  it('returns service result on happy path', async () => {
    vi.mocked(application.setApplicationStatus).mockResolvedValueOnce({ newStateVersion: 1 } as never)
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ newStateVersion: 1 })
  })

  it('maps ConcurrencyError to CONCURRENCY', async () => {
    vi.mocked(application.setApplicationStatus).mockRejectedValueOnce(new ConcurrencyError(0, 2))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('CONCURRENCY')
  })

  it('maps NotFoundError to NOT_FOUND', async () => {
    vi.mocked(application.setApplicationStatus).mockRejectedValueOnce(new NotFoundError('session', 's1'))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('NOT_FOUND')
  })

  it('propagates policyCode from ValidationError', async () => {
    vi.mocked(application.setApplicationStatus).mockRejectedValueOnce(
      new ValidationError('validation', 'Validation not passed', 'POLICY_VALIDATION_NOT_PASSED'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb({ ...VALID_ARGS, status: 'completed' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('POLICY_VALIDATION_NOT_PASSED')
  })

  it('falls back to VALIDATION:<field> when no policyCode', async () => {
    vi.mocked(application.setApplicationStatus).mockRejectedValueOnce(
      new ValidationError('status', 'bad'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('VALIDATION:status')
  })
})
