import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerSaveSectionDraft, inputShape, inputSchema } from '@/lib/ai/agent/mcp/write/save-section-draft'
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
  } as unknown as Parameters<typeof registerSaveSectionDraft>[0]
  registerSaveSectionDraft(server, ctx)
  if (!captured) throw new Error('server.tool not called')
  return captured
}

const VALID_ARGS = {
  sessionId: '22222222-2222-4222-8222-222222222222',
  sectionKey: 'obiective',
  content: 'content',
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

describe('MCP save_section_draft handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exports inputShape and inputSchema', () => {
    expect(inputShape).toBeDefined()
    expect(inputSchema).toBeDefined()
    expect(inputSchema.parse(VALID_ARGS)).toEqual(VALID_ARGS)
  })

  it('returns service result on happy path', async () => {
    vi.mocked(sections.saveSectionDraft).mockResolvedValueOnce({
      sectionId: 's1',
      versionNumber: 1,
      newStateVersion: 1,
    } as never)
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({
      sectionId: 's1',
      versionNumber: 1,
      newStateVersion: 1,
    })
  })

  it('maps ConcurrencyError to code: CONCURRENCY', async () => {
    vi.mocked(sections.saveSectionDraft).mockRejectedValueOnce(new ConcurrencyError(0, 2))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    const body = JSON.parse(result.content[0].text)
    expect(body.code).toBe('CONCURRENCY')
    expect(body.expected).toBe(0)
    expect(body.actual).toBe(2)
  })

  it('maps NotFoundError to code: NOT_FOUND', async () => {
    vi.mocked(sections.saveSectionDraft).mockRejectedValueOnce(new NotFoundError('section', 'obiective'))
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('NOT_FOUND')
  })

  it('propagates policyCode when ValidationError has it (3-arg form)', async () => {
    vi.mocked(sections.saveSectionDraft).mockRejectedValueOnce(
      new ValidationError('outlineFrozen', 'Outline must be frozen', 'POLICY_OUTLINE_NOT_FROZEN'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    const body = JSON.parse(result.content[0].text)
    expect(body.code).toBe('POLICY_OUTLINE_NOT_FROZEN')
    expect(body.field).toBe('outlineFrozen')
  })

  it('falls back to VALIDATION:<field> when ValidationError has no policyCode (2-arg form)', async () => {
    vi.mocked(sections.saveSectionDraft).mockRejectedValueOnce(
      new ValidationError('content', 'Content required'),
    )
    const cb = registerAndCapture(makeCtx())
    const result = await cb(VALID_ARGS)
    expect(result.isError).toBe(true)
    const body = JSON.parse(result.content[0].text)
    expect(body.code).toBe('VALIDATION:content')
    expect(body.field).toBe('content')
  })

  it('rethrows unexpected errors', async () => {
    vi.mocked(sections.saveSectionDraft).mockRejectedValueOnce(new Error('db boom'))
    const cb = registerAndCapture(makeCtx())
    await expect(cb(VALID_ARGS)).rejects.toThrow('db boom')
  })
})
