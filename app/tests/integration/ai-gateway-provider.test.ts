import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIGatewayProvider } from '@/lib/ai/providers/gateway';
import { AIProvider, TaskType } from '@/lib/ai/types';

describe('AI gateway provider contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses OpenAI-compatible chat completions for text generation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'chatcmpl-1',
        model: 'gpt-4o-mini',
        choices: [{ message: { content: 'Generated text' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AIGatewayProvider({
      apiKey: 'test-key',
      baseURL: 'https://gateway.example.com',
    });

    const response = await provider.generateText({
      taskType: TaskType.SIMPLE_TEXT_GENERATION,
      prompt: 'Hello',
      systemPrompt: 'You are helpful.',
      userTier: 'pro',
      userId: 'user-1',
      priority: 'normal',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'X-User-ID': 'user-1',
        }),
      }),
    );
    expect(response.provider).toBe(AIProvider.AI_GATEWAY);
    expect(response.content).toBe('Generated text');
  });

  it('uses OpenAI-compatible embeddings endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AIGatewayProvider({
      apiKey: 'test-key',
      baseURL: 'https://gateway.example.com',
    });

    const embedding = await provider.embed('hello');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });
});
