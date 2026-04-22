import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()

class MockOpenAI {
  chat = { completions: { create: createMock } }
}

vi.mock('openai', () => ({
  default: MockOpenAI,
}))

describe('[PROBE] Anthropic OpenAI-compat shim with tool_calls in messages', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
  })

  it('captures what happens when the router passes a tool turn today (before Task 14 fix)', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
        },
        { role: 'tool', content: '{"r":1}', tool_call_id: 'c1' },
      ],
    })
    const request = createMock.mock.calls[0][0]
    const assistantMsg = request.messages.find((m: { role: string }) => m.role === 'assistant')
    // This assertion documents CURRENT behavior. Update it in the audit doc once observed.
    console.log('PROBE_OBSERVATION', JSON.stringify({
      assistantHasToolCalls: Array.isArray(assistantMsg?.tool_calls),
      toolRoleMessagePresent: request.messages.some((m: { role: string }) => m.role === 'tool'),
    }))
    // No assertion on the shape — Task 14 makes this pass with tool_calls present.
    expect(request).toBeDefined()
  })
})
