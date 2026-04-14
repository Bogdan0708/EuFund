// app/tests/unit/orchestrator-gateway.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'test response' } }],
  usage: { total_tokens: 100 },
})

class MockOpenAI {
  chat = { completions: { create: mockCreate } }
  embeddings = { create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) }
}

vi.mock('openai', () => ({ default: MockOpenAI }))

describe('Gateway Client V2', () => {
  it('routes GPT-5.4 through OpenAI provider', async () => {
    const { createGatewayClient } = await import('@/lib/ai/orchestrator/gateway')
    const client = createGatewayClient('fondeu')
    const result = await client.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })
    expect(result.content).toBe('test response')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('sends max_completion_tokens (not max_tokens) to all providers', async () => {
    mockCreate.mockClear()
    const { createGatewayClient } = await import('@/lib/ai/orchestrator/gateway')
    const client = createGatewayClient('fondeu')
    await client.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      system: 'test',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 8_000,
    })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs).toHaveProperty('max_completion_tokens', 8_000)
    expect(callArgs).not.toHaveProperty('max_tokens')
  })

  it('applies model-specific timeouts', async () => {
    const { getTimeout } = await import('@/lib/ai/orchestrator/gateway')
    expect(getTimeout('claude-opus-4-6')).toBe(300_000)
    expect(getTimeout('gpt-5.4')).toBe(180_000)
    expect(getTimeout('gemini-3.1-pro')).toBe(180_000)
    expect(getTimeout('gemini-3-flash')).toBe(60_000)
    expect(getTimeout('sonar')).toBe(60_000)
    expect(getTimeout('unknown-model')).toBe(60_000)
  })
})
