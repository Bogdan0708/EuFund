import { describe, it, expect } from 'vitest'
import { classifyRow, type RowClassification } from '@/lib/ai/agent/managed/history'
import type { agentMessages } from '@/lib/db/schema'

type Row = typeof agentMessages.$inferSelect

function row(overrides: Partial<Row>): Row {
  return {
    id: 'm-default',
    sessionId: 's-default',
    role: 'user',
    messageType: 'text',
    content: 'hello',
    toolName: null,
    toolCallId: null,
    sequenceNumber: 0,
    compactedAt: null,
    createdAt: new Date(),
    runtimeMode: 'managed',
    provider: null,
    model: null,
    ...overrides,
  } as Row
}

describe('classifyRow', () => {
  it('classifies a user string text row', () => {
    const c = classifyRow(row({ role: 'user', messageType: 'text', content: 'hi' }))
    expect(c.kind).toBe('user_text')
    if (c.kind === 'user_text') expect(c.text).toBe('hi')
  })

  it('classifies a user row with content blocks (managed-native)', () => {
    const blocks = [{ type: 'text', text: 'hi' }]
    const c = classifyRow(row({ role: 'user', messageType: 'text', content: blocks as never }))
    expect(c.kind).toBe('user_text_blocks')
  })

  it('classifies a user managed-native tool_result row', () => {
    const blocks = [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":true}', is_error: false }]
    const c = classifyRow(row({
      role: 'user', messageType: 'tool_result', content: blocks as never,
      toolCallId: 'tu_1', toolName: 'search_calls',
    }))
    expect(c.kind).toBe('user_tool_result_native')
  })

  it('classifies an assistant string text row', () => {
    const c = classifyRow(row({ role: 'assistant', messageType: 'text', content: 'ok' }))
    expect(c.kind).toBe('assistant_text')
  })

  it('classifies an assistant managed-native tool_use row', () => {
    const blocks = [{ type: 'tool_use', id: 'tu_1', name: 'search_calls', input: {} }]
    const c = classifyRow(row({ role: 'assistant', messageType: 'tool_use', content: blocks as never }))
    expect(c.kind).toBe('assistant_blocks_native')
  })

  it('classifies a V3-era assistant tool_call row with explicit toolCallId', () => {
    const c = classifyRow(row({
      id: 'm-42',
      role: 'assistant',
      messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { query: 'pnrr' } } as never,
      toolName: 'search_calls',
      toolCallId: 'tu_xyz',
    }))
    expect(c.kind).toBe('assistant_tool_call_legacy_v3')
    if (c.kind === 'assistant_tool_call_legacy_v3') {
      expect(c.toolUseId).toBe('tu_xyz')
      expect(c.name).toBe('search_calls')
      expect(c.input).toEqual({ query: 'pnrr' })
    }
  })

  it('generates synthetic tu_legacy_<row.id> when V3 tool_call row has null toolCallId', () => {
    const c = classifyRow(row({
      id: 'm-7',
      role: 'assistant',
      messageType: 'tool_call',
      content: { name: 'search_calls', arguments: {} } as never,
      toolName: 'search_calls',
      toolCallId: null,
    }))
    expect(c.kind).toBe('assistant_tool_call_legacy_v3')
    if (c.kind === 'assistant_tool_call_legacy_v3') {
      expect(c.toolUseId).toBe('tu_legacy_m-7')
    }
  })

  it('classifies a V3-era tool_result row with success=true', () => {
    const c = classifyRow(row({
      role: 'tool',
      messageType: 'tool_result',
      content: { success: true, data: { results: [] } } as never,
      toolName: 'search_calls',
      toolCallId: 'tu_xyz',
    }))
    expect(c.kind).toBe('user_tool_result_legacy_v3')
    if (c.kind === 'user_tool_result_legacy_v3') {
      expect(c.isError).toBe(false)
      expect(c.toolUseId).toBe('tu_xyz')
      expect(typeof c.contentString).toBe('string')
    }
  })

  it('classifies a V3-era tool_result row with success=false → isError=true', () => {
    const c = classifyRow(row({
      role: 'tool',
      messageType: 'tool_result',
      content: { success: false, error: 'NOT_FOUND: blah' } as never,
      toolName: 'search_calls',
      toolCallId: 'tu_xyz',
    }))
    expect(c.kind).toBe('user_tool_result_legacy_v3')
    if (c.kind === 'user_tool_result_legacy_v3') expect(c.isError).toBe(true)
  })

  it('generates synthetic tu_legacy_<row.id> for null-toolCallId V3 tool_result', () => {
    const c = classifyRow(row({
      id: 'm-9',
      role: 'tool',
      messageType: 'tool_result',
      content: { success: true } as never,
      toolName: 'search_calls',
      toolCallId: null,
    }))
    expect(c.kind).toBe('user_tool_result_legacy_v3')
    if (c.kind === 'user_tool_result_legacy_v3') expect(c.toolUseId).toBe('tu_legacy_m-9')
  })

  it('classifies a system_summary row', () => {
    const c = classifyRow(row({
      role: 'system',
      messageType: 'system_summary',
      content: 'prior conversation summary text',
    }))
    expect(c.kind).toBe('system_summary')
    if (c.kind === 'system_summary') expect(c.text).toBe('prior conversation summary text')
  })

  it('drops other role=system rows', () => {
    const c = classifyRow(row({ role: 'system', messageType: 'text', content: 'unrelated' }))
    expect(c.kind).toBe('system_drop')
  })

  it('tags malformed rows as unknown_drop with a reason', () => {
    const c = classifyRow(row({ role: 'banana' as never, messageType: 'text', content: 'x' }))
    expect(c.kind).toBe('unknown_drop')
  })
})
