import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskType, type AIRequest, type AIResponse } from '@/lib/ai/types';

class MockRedis {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async setex(key: string, _ttl: number, value: string) { this.store.set(key, value); return 'OK'; }
  async del(...keys: string[]) { keys.forEach((k) => this.store.delete(k)); return keys.length; }
  async keys(pattern: string) {
    const prefix = pattern.replace('*', '');
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
  async info() { return 'used_memory_human:1M'; }
}

function baseRequest(userId: string): AIRequest {
  return {
    userId,
    userTier: 'free',
    taskType: TaskType.PROPOSAL_GENERATION,
    prompt: 'Generate a PNRR proposal for a digital startup',
    priority: 'normal',
    maxTokens: 500,
    temperature: 0.2,
    language: 'ro',
  };
}

function baseResponse(content: string): AIResponse {
  return {
    content,
    provider: 'openai' as any,
    model: 'gpt-4o',
    tokensUsed: { input: 100, output: 200, total: 300 },
    cost: 0.01,
    latency: 1200,
    cached: false,
    requestId: crypto.randomUUID(),
    timestamp: new Date(),
  };
}

describe('AI Cache Tenant Isolation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('stores separate cache entries for different users with identical prompts', async () => {
    vi.doMock('@/lib/redis/client', () => ({
      getRedis: () => new MockRedis(),
    }));

    const { AICache } = await import('@/lib/ai/cache');
    const cache = new AICache({ enabled: true });

    const reqUser1 = baseRequest('user-1');
    const reqUser2 = baseRequest('user-2');

    await cache.set(reqUser1, baseResponse('response-user-1'));
    await cache.set(reqUser2, baseResponse('response-user-2'));

    const result1 = await cache.get(reqUser1);
    const result2 = await cache.get(reqUser2);

    expect(result1?.content).toBe('response-user-1');
    expect(result2?.content).toBe('response-user-2');
    expect(result1?.content).not.toBe(result2?.content);
  });
});

