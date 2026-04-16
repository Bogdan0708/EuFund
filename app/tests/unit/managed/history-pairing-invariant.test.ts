import { describe, it, expect } from 'vitest'
import { ensurePairingInvariant } from '@/lib/ai/agent/managed/history'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'

describe('ensurePairingInvariant', () => {
  it('leaves well-paired tool_use/tool_result untouched', () => {
    const input: MessageParam[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_A', name: 'search', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_A', content: 'ok', is_error: false }] },
    ]
    const out = ensurePairingInvariant([...input])
    expect(out).toEqual(input)
  })

  it('preserves assistant text when trimming an orphan tool_use block', () => {
    const input: MessageParam[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: "I'll search for that" },
          { type: 'tool_use', id: 'tu_orphan', name: 'search', input: {} },
        ],
      },
      { role: 'user', content: 'tell me more' },
    ]
    const out = ensurePairingInvariant(input)
    // Trim the orphan tool_use; keep the text block. No synthetic tool_result.
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: "I'll search for that" }],
    })
    expect(out[1]).toEqual({ role: 'user', content: 'tell me more' })
  })

  it('drops the assistant message entirely when its only content was an orphan tool_use', () => {
    const input: MessageParam[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_orphan', name: 'search', input: {} }] },
      { role: 'user', content: 'what now?' },
    ]
    const out = ensurePairingInvariant(input)
    // Assistant message becomes empty after trimming tu_orphan → drop it entirely.
    // No synthetic tool_result is inserted (trim-only rule).
    expect(out).toEqual([{ role: 'user', content: 'what now?' }])
  })

  it('trims orphan tool_use blocks; keeps valid tool_use + result pair', () => {
    const input: MessageParam[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_A', name: 'search', input: {} },
          { type: 'tool_use', id: 'tu_B', name: 'search', input: {} },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_A', content: 'ok', is_error: false }],
      },
    ]
    const out = ensurePairingInvariant(input)
    // tu_B is orphan (no matching tool_result in the next user message).
    // Trim tu_B from the assistant message. User message is unchanged.
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_A', name: 'search', input: {} }],
    })
    expect(out[1]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_A', content: 'ok', is_error: false }],
    })
  })

  it('drops orphan tool_result blocks with no preceding tool_use', () => {
    const input: MessageParam[] = [
      { role: 'user', content: 'hello' },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_orphan', content: 'ghost', is_error: false }],
      },
    ]
    const out = ensurePairingInvariant(input)
    // The orphan user message has only an orphan tool_result → drop the whole user message
    expect(out).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('drops only orphan tool_result blocks when the user message has other content', () => {
    const input: MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'user text' },
          { type: 'tool_result', tool_use_id: 'tu_orphan', content: 'ghost', is_error: false },
        ],
      },
    ]
    const out = ensurePairingInvariant(input)
    // Drop the orphan tool_result block, keep the text block
    expect(out).toHaveLength(1)
    if (Array.isArray(out[0].content)) {
      expect(out[0].content).toEqual([{ type: 'text', text: 'user text' }])
    }
  })

  it('drops end-of-history assistant message whose only block is an orphan tool_use', () => {
    const input: MessageParam[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_orphan', name: 'search', input: {} }] },
    ]
    const out = ensurePairingInvariant(input)
    // Drop the orphan-only assistant message; nothing to pair with
    expect(out).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('preserves end-of-history assistant text when tool_use is orphan', () => {
    const input: MessageParam[] = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'searching now' },
          { type: 'tool_use', id: 'tu_orphan', name: 'search', input: {} },
        ],
      },
    ]
    const out = ensurePairingInvariant(input)
    // The assistant text is preserved; the orphan tool_use is trimmed.
    // No synthetic tool_result is inserted (trim-only rule).
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'searching now' }],
    })
  })
})
