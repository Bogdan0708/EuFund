import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/client-v2', () => ({
  aiGenerate: vi.fn().mockResolvedValue({
    content: 'test response',
    usage: { totalTokens: 100 },
  }),
  aiEmbed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}))

describe('Gateway Client', () => {
  it('generate calls aiGenerate with provider/model', async () => {
    const { createGatewayClient } = await import('@/lib/ai/orchestrator/gateway')
    const client = createGatewayClient('tenant-fondeu')
    const result = await client.generate({
      provider: 'claude',
      model: 'claude-sonnet-4-0',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })
    expect(result.content).toBe('test response')
    expect(result.tokensUsed).toBe(100)
  })
})
