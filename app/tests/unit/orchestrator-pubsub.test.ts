import { describe, it, expect } from 'vitest'

describe('Orchestrator PubSub', () => {
  it('getChannelName returns correct channel', async () => {
    const { getChannelName } = await import('@/lib/ai/orchestrator/pubsub')
    expect(getChannelName('session-123')).toBe('orchestrator:session-123')
  })
})
