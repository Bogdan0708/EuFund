import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerRejectSection, inputShape, inputSchema } from '@/lib/ai/agent/mcp/write/reject-section'
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
  } as unknown as Parameters<typeof registerRejectSection>[0]
  registerRejectSection(server, ctx)
  if (!captured) throw new Error('server.tool not called')
  return captured
}

const VALID_ARGS = {
  sectionKey: 'obiective',
  reason: 'Does not align with priorities',
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

describe('MCP reject_section handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exports inputShape and inputSchema', () => {
    expect(inputShape).toBeDefined()
    expect(inputSchema.parse(VALID_ARGS)).toEqual(VALID_ARGS)
  })

  it('rejects empty reason at schema level', () => {
    expect(() => inputSchema.parse({ ...VALID_ARGS, reason: '' })).toThrow()
  })

  it('returns service result on happy path', async () => {
    vi.mocked(sections.rejectSection).mockResolvedValueOnce({ newStateVersion: 1 })
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ newStateVersion: 1 })
  })

  it('idempotent same-reason returns newStateVersion from service (no error)', async () => {
    vi.mocked(sections.rejectSection).mockResolvedValueOnce({ newStateVersion: 0 })
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ newStateVersion: 0 })
  })

  it('different-reason re-reject returns POLICY_SECTION_WRONG_STATE', async () => {
    vi.mocked(sections.rejectSection).mockRejectedValueOnce(
      new ValidationError('reason', 'Section already rejected with a different reason; cannot edit rejection metadata', 'POLICY_SECTION_WRONG_STATE'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('POLICY_SECTION_WRONG_STATE')
  })

  it('maps ConcurrencyError to CONCURRENCY', async () => {
    vi.mocked(sections.rejectSection).mockRejectedValueOnce(new ConcurrencyError(0, 2))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('CONCURRENCY')
  })

  it('maps NotFoundError to NOT_FOUND', async () => {
    vi.mocked(sections.rejectSection).mockRejectedValueOnce(new NotFoundError('section', 'obiective'))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('NOT_FOUND')
  })
})
