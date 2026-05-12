// Regression: V3 history replay used to ship dangling tool_use blocks to
// Anthropic when a previous turn persisted `tool_call` but crashed before
// persisting the matching `tool_result`. Synthesis broadening (PR #99
// commit 3fe1966b) made this latent bug more likely to surface — every
// no-text exit now fires an extra LLM call against the same history.

import { describe, it, expect } from 'vitest'
import { ensureV3PairingInvariant, type RouterMessage } from '@/lib/ai/agent/history'

describe('ensureV3PairingInvariant', () => {
  it('passes through messages without tool_calls or tool roles untouched', () => {
    const input: RouterMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]
    expect(ensureV3PairingInvariant(input)).toEqual(input)
  })

  it('keeps a balanced tool_call + tool_result pair unchanged', () => {
    const input: RouterMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'search_calls', arguments: '{}' } }],
      },
      { role: 'tool', content: '{"success":true,"data":[]}', tool_call_id: 'tc-1' },
      { role: 'assistant', content: 'done' },
    ]
    expect(ensureV3PairingInvariant(input)).toEqual(input)
  })

  it('strips an orphan tool_call (no matching tool message follows)', () => {
    const input: RouterMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'tc-orphan', type: 'function', function: { name: 'search_calls', arguments: '{}' } }],
      },
      // No tool message — assistant's tool_call is an orphan
      { role: 'user', content: 'still there?' },
    ]
    const out = ensureV3PairingInvariant(input)
    // Assistant message had empty content + only orphan tool_call → dropped entirely
    expect(out).toEqual([
      { role: 'user', content: 'go' },
      { role: 'user', content: 'still there?' },
    ])
  })

  it('keeps an orphan-tool_call assistant message if it has text content', () => {
    const input: RouterMessage[] = [
      {
        role: 'assistant',
        content: 'I will search now.',
        tool_calls: [{ id: 'tc-orphan', type: 'function', function: { name: 'search_calls', arguments: '{}' } }],
      },
      { role: 'user', content: 'next' },
    ]
    const out = ensureV3PairingInvariant(input)
    expect(out).toEqual([
      { role: 'assistant', content: 'I will search now.' },
      { role: 'user', content: 'next' },
    ])
  })

  it('trims only the orphan tool_calls when some are paired and some are not', () => {
    const input: RouterMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'tc-paired', type: 'function', function: { name: 'search_calls', arguments: '{}' } },
          { id: 'tc-orphan', type: 'function', function: { name: 'run_eligibility', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: '{}', tool_call_id: 'tc-paired' },
      { role: 'user', content: 'next' },
    ]
    const out = ensureV3PairingInvariant(input)
    expect(out[0]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'tc-paired', type: 'function', function: { name: 'search_calls', arguments: '{}' } }],
    })
    expect(out[1]).toEqual({ role: 'tool', content: '{}', tool_call_id: 'tc-paired' })
    expect(out[2]).toEqual({ role: 'user', content: 'next' })
  })

  it('drops orphan tool_result rows whose preceding assistant has no matching tool_call', () => {
    const input: RouterMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'thinking' },
      // Persisted tool_result whose tool_call was compacted/lost
      { role: 'tool', content: '{}', tool_call_id: 'tc-ghost' },
      { role: 'user', content: 'next' },
    ]
    const out = ensureV3PairingInvariant(input)
    expect(out).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'thinking' },
      { role: 'user', content: 'next' },
    ])
  })

  it('drops a tool_result message that lacks tool_call_id entirely', () => {
    const input: RouterMessage[] = [
      { role: 'assistant', content: '' },
      // Corrupt tool message with no id (would 400 upstream)
      { role: 'tool', content: '{}' },
    ]
    expect(ensureV3PairingInvariant(input)).toEqual([{ role: 'assistant', content: '' }])
  })

  it('compounds repairs: trimmed assistant cascades to drop the dependent tool_result', () => {
    // The orphan tool_call gets stripped from the assistant. Without
    // operating on the OUTPUT array for the back-reference, the next
    // tool message would still match the trimmed-away tool_call id.
    const input: RouterMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      },
      // No matching tool message → assistant gets fully dropped (empty content + orphan tc)
      { role: 'user', content: 'continue' },
      { role: 'tool', content: '{}', tool_call_id: 'tc-1' }, // stale ref from before
    ]
    const out = ensureV3PairingInvariant(input)
    // Both the dangling assistant AND the stale tool message should be gone
    expect(out.some((m) => m.role === 'assistant' && m.tool_calls)).toBe(false)
    expect(out.some((m) => m.role === 'tool')).toBe(false)
  })

  it('matches multiple tool_results that follow a single assistant turn', () => {
    // The V3 replay flattens each tool_result as its own message; one
    // assistant turn may produce multiple tool_calls that get answered
    // by multiple tool messages in sequence.
    const input: RouterMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'tc-a', type: 'function', function: { name: 'x', arguments: '{}' } },
          { id: 'tc-b', type: 'function', function: { name: 'y', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: '{}', tool_call_id: 'tc-a' },
      { role: 'tool', content: '{}', tool_call_id: 'tc-b' },
      { role: 'user', content: 'next' },
    ]
    expect(ensureV3PairingInvariant(input)).toEqual(input)
  })

  it('does not mutate the input array', () => {
    const input: RouterMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'tc-orphan', type: 'function', function: { name: 'x', arguments: '{}' } }],
      },
    ]
    const snapshot = JSON.parse(JSON.stringify(input))
    ensureV3PairingInvariant(input)
    expect(input).toEqual(snapshot)
  })
})
