// Regression test for Issue #81: loadContext must filter by
// runtimeMode='v3' so that V3 replay never sees managed-runtime
// rows after a managed→V3 degradation. Cross-runtime contamination
// would otherwise feed the V3 model managed-shape content blocks
// (assistant rows whose toolCallId column is null with content as
// AnthropicContentBlock[], and tool_result rows with role='user'
// instead of role='tool').
//
// The mock below introspects the where() argument (a drizzle SQL
// builder) for the literal 'v3' so that the filtered query only
// returns runtimeMode='v3' rows. Without the production fix, the
// first select's where() would not contain the v3 literal — the
// mock would return all mockRows, and the test would observe
// managed rows leaking into the LLM context.

import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRows: any[] = []
let selectCallCount = 0

vi.mock('@/lib/db', () => {
  // The first select() in loadContext is the filtered query (uncompacted +
  // runtimeMode='v3'). The second is the unfiltered totalCount/summary
  // probe. We differentiate by call-order and introspect the where()
  // argument's stringified form for the literal 'v3' to decide whether
  // to apply the runtime filter.
  const selectImpl = () => {
    selectCallCount += 1
    const isFirst = selectCallCount === 1

    const limitFn = vi.fn().mockImplementation(() => Promise.resolve(mockRows.slice(-1)))
    const orderByFn = vi.fn().mockImplementation(() => {
      const rowsToReturn = isFirst ? filterV3IfRequested(mockRows, lastWhereArg) : mockRows
      const p = Promise.resolve(rowsToReturn)
      return Object.assign(p, { limit: limitFn })
    })
    let lastWhereArg: unknown = null
    const whereFn = vi.fn().mockImplementation((arg: unknown) => {
      lastWhereArg = arg
      const rowsToReturn = isFirst ? filterV3IfRequested(mockRows, lastWhereArg) : mockRows
      const p = Promise.resolve(rowsToReturn)
      return Object.assign(p, { orderBy: orderByFn })
    })
    const fromFn = vi.fn().mockImplementation(() => ({
      where: whereFn,
      orderBy: orderByFn,
    }))
    return { from: fromFn }
  }

  function filterV3IfRequested(rows: any[], whereArg: unknown): any[] {
    if (!whereArg) return rows
    if (!whereContains(whereArg, 'v3')) return rows
    return rows.filter((r) => (r.runtimeMode ?? 'v3') === 'v3')
  }

  // Drizzle SQL builders contain circular refs (column → table → columns),
  // so JSON.stringify throws. Walk the tree manually with a visited set,
  // looking for the literal value 'v3' anywhere in queryChunks.
  function whereContains(node: unknown, needle: string, seen = new WeakSet()): boolean {
    if (node === needle) return true
    if (typeof node !== 'object' || node === null) return false
    if (seen.has(node as object)) return false
    seen.add(node as object)
    if (Array.isArray(node)) {
      return node.some((v) => whereContains(v, needle, seen))
    }
    return Object.values(node as Record<string, unknown>).some((v) => whereContains(v, needle, seen))
  }

  return {
    db: {
      select: selectImpl,
      insert: vi.fn(),
      update: vi.fn(),
    },
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { loadContext } from '@/lib/ai/agent/history'

describe('loadContext — runtimeMode filter (Issue #81)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRows = []
    selectCallCount = 0
  })

  it('filters out managed-runtime rows when loading V3 replay context', async () => {
    // Mixed-runtime session: 2 V3 tool_call rows, 1 V3 tool_result row,
    // 1 managed assistant row (content as Anthropic content blocks),
    // 1 managed tool_result row (role='user' with array content).
    mockRows = [
      // V3 tool_call: assistant role, messageType='tool_call', toolCallId set,
      // content is the JSON-encoded {name, arguments} object.
      {
        id: 'msg-v3-1',
        role: 'assistant',
        messageType: 'tool_call',
        content: { name: 'search_calls', arguments: '{"query":"PNRR"}' },
        toolCallId: 'call_v3_a',
        toolName: 'search_calls',
        sequenceNumber: 0,
        compactedAt: null,
        runtimeMode: 'v3',
      },
      // V3 tool_result: role='tool', messageType='tool_result', toolCallId set.
      {
        id: 'msg-v3-2',
        role: 'tool',
        messageType: 'tool_result',
        content: { success: true, data: { matches: [] } },
        toolCallId: 'call_v3_a',
        toolName: 'search_calls',
        sequenceNumber: 1,
        compactedAt: null,
        runtimeMode: 'v3',
      },
      // Managed assistant: role='assistant', content is AnthropicContentBlock[],
      // and the tool-use id lives INSIDE content[] — the toolCallId column is null.
      {
        id: 'msg-managed-1',
        role: 'assistant',
        messageType: 'text',
        content: [
          { type: 'text', text: 'Looking up the call now.' },
          { type: 'tool_use', id: 'toolu_managed_a', name: 'search_calls', input: { query: 'PNRR' } },
        ],
        toolCallId: null,
        toolName: null,
        sequenceNumber: 2,
        compactedAt: null,
        runtimeMode: 'managed',
      },
      // Managed tool_result: role='user' (NOT 'tool'), content is array of
      // {type:'tool_result', tool_use_id, content} blocks.
      {
        id: 'msg-managed-2',
        role: 'user',
        messageType: 'tool_result',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_managed_a', content: 'ok' }],
        toolCallId: 'toolu_managed_a',
        toolName: 'search_calls',
        sequenceNumber: 3,
        compactedAt: null,
        runtimeMode: 'managed',
      },
      // Another V3 tool_call to confirm ordering survives the filter.
      {
        id: 'msg-v3-3',
        role: 'assistant',
        messageType: 'tool_call',
        content: { name: 'get_application_state', arguments: '{}' },
        toolCallId: 'call_v3_b',
        toolName: 'get_application_state',
        sequenceNumber: 4,
        compactedAt: null,
        runtimeMode: 'v3',
      },
    ]

    const ctx = await loadContext('mixed-session')

    // Only the 3 V3 rows should appear.
    expect(ctx.messages).toHaveLength(3)

    // None of the surfaced messages should be a managed-shape row.
    // Managed assistant rows have array content (which would JSON-stringify
    // and contain '"tool_use"'); managed tool_result rows are role='user'
    // with array content. Detect either signature.
    for (const m of ctx.messages) {
      expect(m.content).not.toContain('"tool_use"')
      expect(m.content).not.toContain('toolu_managed_a')
    }

    // Confirm the V3 rows specifically came through, including their
    // dedicated columns being preserved.
    const v3ToolCallIds = ctx.messages
      .filter((m) => m.toolCallId)
      .map((m) => m.toolCallId)
    expect(v3ToolCallIds).toEqual(expect.arrayContaining(['call_v3_a', 'call_v3_b']))
  })

  it('returns empty messages when the session contains only managed-runtime rows', async () => {
    mockRows = [
      {
        id: 'msg-m-1',
        role: 'assistant',
        messageType: 'text',
        content: [{ type: 'tool_use', id: 'toolu_x', name: 'search_calls', input: {} }],
        toolCallId: null,
        toolName: null,
        sequenceNumber: 0,
        compactedAt: null,
        runtimeMode: 'managed',
      },
      {
        id: 'msg-m-2',
        role: 'user',
        messageType: 'tool_result',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'ok' }],
        toolCallId: 'toolu_x',
        toolName: 'search_calls',
        sequenceNumber: 1,
        compactedAt: null,
        runtimeMode: 'managed',
      },
    ]

    const ctx = await loadContext('managed-only-session')
    expect(ctx.messages).toEqual([])
    // Split decision: totalCount tracks V3 history depth (gauges the V3
    // compaction-threshold check), so a managed-only session reports 0
    // even though the underlying table holds 2 rows. This prevents
    // managed turns from prematurely tripping V3 compaction after a
    // managed→V3 degradation.
    expect(ctx.totalCount).toBe(0)
  })

  it('returns all rows for a single-runtime V3 session (backward compatibility)', async () => {
    mockRows = [
      {
        id: 'msg-v3-1',
        role: 'user',
        messageType: 'text',
        content: 'Help me draft a PNRR application',
        toolCallId: null,
        toolName: null,
        sequenceNumber: 0,
        compactedAt: null,
        runtimeMode: 'v3',
      },
      {
        id: 'msg-v3-2',
        role: 'assistant',
        messageType: 'text',
        content: 'Sure, let me look at the eligibility criteria.',
        toolCallId: null,
        toolName: null,
        sequenceNumber: 1,
        compactedAt: null,
        runtimeMode: 'v3',
      },
      {
        id: 'msg-v3-3',
        role: 'assistant',
        messageType: 'tool_call',
        content: { name: 'search_calls', arguments: '{"q":"PNRR"}' },
        toolCallId: 'call_a',
        toolName: 'search_calls',
        sequenceNumber: 2,
        compactedAt: null,
        runtimeMode: 'v3',
      },
    ]

    const ctx = await loadContext('v3-only-session')
    expect(ctx.messages).toHaveLength(3)
    expect(ctx.messages[0].content).toBe('Help me draft a PNRR application')
    expect(ctx.messages[2].toolCallId).toBe('call_a')
  })

  it('finds a system_summary row regardless of its runtimeMode tag', async () => {
    // Split decision: the totalCount/summary lookup is NOT runtime-filtered
    // because a managed-runtime summary row can still apply when V3 replays
    // a degraded session. Verify both: filtered messages hide the managed
    // turns AND the summary still surfaces.
    mockRows = [
      {
        id: 'msg-v3-1',
        role: 'user',
        messageType: 'text',
        content: 'Initial question',
        toolCallId: null,
        toolName: null,
        sequenceNumber: 0,
        compactedAt: null,
        runtimeMode: 'v3',
      },
      {
        id: 'msg-managed-1',
        role: 'assistant',
        messageType: 'text',
        content: [{ type: 'text', text: 'managed-only block that V3 must not see' }],
        toolCallId: null,
        toolName: null,
        sequenceNumber: 1,
        compactedAt: null,
        runtimeMode: 'managed',
      },
      // Summary written by managed runtime — should still surface.
      {
        id: 'msg-summary',
        role: 'system',
        messageType: 'system_summary',
        content: 'Earlier turns: user asked about PNRR; assistant searched calls.',
        toolCallId: null,
        toolName: null,
        sequenceNumber: 2,
        compactedAt: null,
        runtimeMode: 'managed',
      },
    ]

    const ctx = await loadContext('mixed-with-summary')

    // Only the V3 user message reaches the LLM context.
    expect(ctx.messages).toHaveLength(1)
    expect(ctx.messages[0].content).toBe('Initial question')

    // Summary still found despite its runtimeMode='managed' tag.
    expect(ctx.summary).toBe('Earlier turns: user asked about PNRR; assistant searched calls.')
  })
})
