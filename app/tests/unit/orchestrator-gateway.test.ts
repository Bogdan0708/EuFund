import { describe, it, expect, vi } from 'vitest'

// Mock OpenAI constructor — gateway now uses OpenAI SDK directly
const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'test response' } }],
  usage: { total_tokens: 100 },
})

class MockOpenAI {
  chat = { completions: { create: mockCreate } }
  embeddings = { create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) }
}

vi.mock('openai', () => ({ default: MockOpenAI }))

describe('Gateway Client', () => {
  it('generate calls OpenAI SDK with provider/model', async () => {
    const { createGatewayClient } = await import('@/lib/ai/orchestrator/gateway')
    const client = createGatewayClient('tenant-fondeu')
    const result = await client.generate({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })
    expect(result.content).toBe('test response')
    expect(result.tokensUsed).toBe(100)
  })
})
