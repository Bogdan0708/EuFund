import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerSetSelectedCall, inputShape, inputSchema } from '@/lib/ai/agent/mcp/write/set-selected-call'
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
  } as unknown as Parameters<typeof registerSetSelectedCall>[0]
  registerSetSelectedCall(server, ctx)
  if (!captured) throw new Error('server.tool not called')
  return captured
}

const VALID_ARGS = {
  sessionId: '22222222-2222-4222-8222-222222222222',
  callId: 'CALL-2026-001',
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

describe('MCP set_selected_call handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exports inputShape and inputSchema', () => {
    expect(inputShape).toBeDefined()
    expect(inputSchema.parse(VALID_ARGS)).toEqual(VALID_ARGS)
  })

  it('rejects empty callId at schema level', () => {
    expect(() => inputSchema.parse({ ...VALID_ARGS, callId: '' })).toThrow()
  })

  it('rejects non-uuid sessionId at schema level', () => {
    expect(() => inputSchema.parse({ ...VALID_ARGS, sessionId: 'not-uuid' })).toThrow()
  })

  it('returns service result on happy path', async () => {
    vi.mocked(application.setSelectedCall).mockResolvedValueOnce({ newStateVersion: 1 })
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ newStateVersion: 1 })
  })

  it('maps ConcurrencyError to CONCURRENCY', async () => {
    vi.mocked(application.setSelectedCall).mockRejectedValueOnce(new ConcurrencyError(0, 2))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    const body = JSON.parse(result.content[0].text)
    expect(body.code).toBe('CONCURRENCY')
    expect(body.expected).toBe(0)
    expect(body.actual).toBe(2)
  })

  it('maps NotFoundError to NOT_FOUND', async () => {
    vi.mocked(application.setSelectedCall).mockRejectedValueOnce(new NotFoundError('session', 's1'))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('NOT_FOUND')
  })

  it('propagates POLICY_OUTLINE_ALREADY_FROZEN from ValidationError', async () => {
    vi.mocked(application.setSelectedCall).mockRejectedValueOnce(
      new ValidationError('outlineFrozen', 'Outline already frozen', 'POLICY_OUTLINE_ALREADY_FROZEN'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('POLICY_OUTLINE_ALREADY_FROZEN')
  })

  it('falls back to VALIDATION:<field> when no policyCode', async () => {
    vi.mocked(application.setSelectedCall).mockRejectedValueOnce(
      new ValidationError('callId', 'bad'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('VALIDATION:callId')
  })

  it('rethrows unexpected errors', async () => {
    vi.mocked(application.setSelectedCall).mockRejectedValueOnce(new Error('db boom'))
    const cb = registerAndCapture(makeCtx())
    await expect(cb(VALID_ARGS)).rejects.toThrow('db boom')
  })
})
