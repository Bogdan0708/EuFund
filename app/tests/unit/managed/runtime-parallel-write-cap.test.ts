import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import type { ServiceContext } from '@/lib/ai/agent/services/types'
import type { ExecutorResult } from '@/lib/ai/agent/managed/executor'
import { executeToolBlocksWithWriteCap } from '@/lib/ai/agent/managed/runtime'

function makeCtx(allowWrites = true): ServiceContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    requestId: 'req-1',
    now: new Date(),
    allowWrites,
  }
}

describe('runtime parallel-write cap', () => {
  beforeEach(() => vi.clearAllMocks())

  it('executes a single write block normally', async () => {
    const execMock = vi.fn<(b: ToolUseBlock, c: ServiceContext) => Promise<ExecutorResult>>()
      .mockResolvedValue({
        content: '{"ok":true}',
        isError: false,
        toolName: 'save_section_draft',
        latencyMs: 10,
      })
    const out = await executeToolBlocksWithWriteCap(
      [{ type: 'tool_use', id: 'tu_1', name: 'save_section_draft', input: {} }],
      makeCtx(),
      execMock,
    )
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(1)
    expect(out[0].result.isError).toBe(false)
  })

  it('executes the first write, rejects subsequent writes with PARALLEL_WRITE_BLOCKED', async () => {
    const execMock = vi.fn<(b: ToolUseBlock, c: ServiceContext) => Promise<ExecutorResult>>()
      .mockResolvedValue({
        content: '{"ok":true}',
        isError: false,
        toolName: 'save_section_draft',
        latencyMs: 10,
      })
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'save_section_draft', input: { sectionKey: 'a' } },
      { type: 'tool_use', id: 'tu_2', name: 'save_section_draft', input: { sectionKey: 'b' } },
      { type: 'tool_use', id: 'tu_3', name: 'approve_revision', input: { sectionKey: 'a' } },
    ]
    const out = await executeToolBlocksWithWriteCap(blocks, makeCtx(), execMock)
    // Executor called only once (for the first write)
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock).toHaveBeenCalledWith(blocks[0], expect.anything())
    // Results preserve order
    expect(out).toHaveLength(3)
    expect(out[0].block.id).toBe('tu_1')
    expect(out[0].result.isError).toBe(false)
    expect(out[1].block.id).toBe('tu_2')
    expect(out[1].result.isError).toBe(true)
    expect(out[1].result.content).toMatch(/^PARALLEL_WRITE_BLOCKED:/)
    expect(out[1].result.toolName).toBe('save_section_draft')
    expect(out[2].block.id).toBe('tu_3')
    expect(out[2].result.isError).toBe(true)
    expect(out[2].result.content).toMatch(/^PARALLEL_WRITE_BLOCKED:/)
  })

  it('does NOT cap non-write tool calls — read tools run alongside the first write', async () => {
    const execMock = vi.fn<(b: ToolUseBlock, c: ServiceContext) => Promise<ExecutorResult>>()
      .mockImplementation((block) => Promise.resolve({
        content: '{}',
        isError: false,
        toolName: block.name,
        latencyMs: 5,
      }))
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'get_application_state', input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'save_section_draft', input: {} },
      { type: 'tool_use', id: 'tu_3', name: 'list_sections', input: {} },
      { type: 'tool_use', id: 'tu_4', name: 'save_section_draft', input: {} },
      { type: 'tool_use', id: 'tu_5', name: 'search_calls', input: {} },
    ]
    const out = await executeToolBlocksWithWriteCap(blocks, makeCtx(), execMock)
    // Executor called for: tu_1 (read), tu_2 (first write), tu_3 (read), tu_5 (read) — 4 calls
    expect(execMock).toHaveBeenCalledTimes(4)
    const called = execMock.mock.calls.map((c) => (c[0] as ToolUseBlock).id)
    expect(called).toEqual(['tu_1', 'tu_2', 'tu_3', 'tu_5'])
    // tu_4 is blocked with PARALLEL_WRITE_BLOCKED
    const out4 = out.find((r) => r.block.id === 'tu_4')!
    expect(out4.result.isError).toBe(true)
    expect(out4.result.content).toMatch(/^PARALLEL_WRITE_BLOCKED:/)
    // Order preserved across all 5 results
    expect(out.map((r) => r.block.id)).toEqual(['tu_1', 'tu_2', 'tu_3', 'tu_4', 'tu_5'])
  })

  it('zero writes in the batch runs everything normally', async () => {
    const execMock = vi.fn<(b: ToolUseBlock, c: ServiceContext) => Promise<ExecutorResult>>()
      .mockResolvedValue({ content: '{}', isError: false, toolName: 'x', latencyMs: 5 })
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'search_calls', input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'list_sections', input: {} },
    ]
    await executeToolBlocksWithWriteCap(blocks, makeCtx(), execMock)
    expect(execMock).toHaveBeenCalledTimes(2)
  })

  it('synthetic PARALLEL_WRITE_BLOCKED result uses the blocked block.name as toolName', async () => {
    const execMock = vi.fn<(b: ToolUseBlock, c: ServiceContext) => Promise<ExecutorResult>>()
      .mockResolvedValue({ content: '{"ok":true}', isError: false, toolName: 'save_section_draft', latencyMs: 1 })
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'save_section_draft', input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'freeze_outline', input: {} },
    ]
    const out = await executeToolBlocksWithWriteCap(blocks, makeCtx(), execMock)
    expect(out[1].result.toolName).toBe('freeze_outline')
    expect(out[1].result.isError).toBe(true)
  })
})
