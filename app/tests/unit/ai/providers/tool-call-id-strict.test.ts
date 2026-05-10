// app/tests/unit/ai/providers/tool-call-id-strict.test.ts
//
// Defense-in-depth: every provider adapter that translates a RouterMessage with
// role='tool' MUST refuse to send `tool_call_id: ''` upstream. The old behavior
// was `m.tool_call_id || ''` / `?? ''`, which silently produced garbage that
// Anthropic's OpenAI-compat shim then rejected with
//   "tool_call_id of '' not found"
// — but only on the 2nd turn of a session that previously called a tool, which
// made it look like a flaky bug. Throw locally instead.

import { describe, it, expect, vi } from 'vitest'
import type { RouterMessage } from '@/lib/ai/providers/types'

const createMock = vi.fn()
const nativeAnthropicCreateMock = vi.fn()

class MockOpenAI {
  chat = { completions: { create: createMock } }
  embeddings = { create: vi.fn() }
}

vi.mock('openai', () => ({
  default: MockOpenAI,
}))

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({
    messages: { create: nativeAnthropicCreateMock },
  }),
}))

describe('Provider adapters — strict tool_call_id', () => {
  describe('openaiProvider', () => {
    it('throws when a tool message has no tool_call_id', async () => {
      const { openaiProvider } = await import('@/lib/ai/providers/openai')
      await expect(
        openaiProvider.generate({
          provider: 'openai',
          model: 'gpt-5.4',
          // Issue #83 item 6: RouterMessage now requires tool_call_id when
          // role==='tool'. The cast preserves the runtime test (the provider
          // adapter's defensive throw still has to fire for any non-typed
          // legacy caller). Same pattern below.
          messages: [{ role: 'tool', content: '{"ok":true}' } as unknown as RouterMessage],
        }),
      ).rejects.toThrow(/tool_call_id/)
      expect(createMock).not.toHaveBeenCalled()
    })

    it('throws when a tool message has empty-string tool_call_id', async () => {
      const { openaiProvider } = await import('@/lib/ai/providers/openai')
      await expect(
        openaiProvider.generate({
          provider: 'openai',
          model: 'gpt-5.4',
          messages: [{ role: 'tool', content: '{"ok":true}', tool_call_id: '' }],
        }),
      ).rejects.toThrow(/tool_call_id/)
    })
  })

  describe('anthropicProvider (OpenAI-compat shim path)', () => {
    it('throws when a tool message has no tool_call_id', async () => {
      const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
      // cache disabled → shim path
      await expect(
        anthropicProvider.generate({
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          messages: [{ role: 'tool', content: '{"ok":true}' } as unknown as RouterMessage],
        }),
      ).rejects.toThrow(/tool_call_id/)
    })
  })

  describe('googleProvider', () => {
    it('throws when a tool message has no tool_call_id', async () => {
      const { googleProvider } = await import('@/lib/ai/providers/google')
      await expect(
        googleProvider.generate({
          provider: 'google',
          model: 'gemini-3-flash',
          messages: [{ role: 'tool', content: '{"ok":true}' } as unknown as RouterMessage],
        }),
      ).rejects.toThrow(/tool_call_id/)
    })
  })

  describe('perplexityProvider', () => {
    it('throws when a tool message has no tool_call_id', async () => {
      const { perplexityProvider } = await import('@/lib/ai/providers/perplexity')
      await expect(
        perplexityProvider.generate({
          provider: 'perplexity',
          model: 'sonar',
          messages: [{ role: 'tool', content: '{"ok":true}' } as unknown as RouterMessage],
        }),
      ).rejects.toThrow(/tool_call_id/)
    })
  })

  describe('anthropic-native (cache-enabled path)', () => {
    it('throws when a tool message has no tool_call_id', async () => {
      const { anthropicNativeGenerate } = await import('@/lib/ai/providers/anthropic-native')
      await expect(
        anthropicNativeGenerate({
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          messages: [{ role: 'tool', content: '{"ok":true}' } as unknown as RouterMessage],
          cache: { enabled: true },
        }),
      ).rejects.toThrow(/tool_call_id/)
      expect(nativeAnthropicCreateMock).not.toHaveBeenCalled()
    })
  })
})
