import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openAIConstructor: vi.fn(),
  gatewayChatCreate: vi.fn(),
  gatewayEmbeddingsCreate: vi.fn(),
}));

vi.mock('openai', () => {
  function OpenAI(config: unknown) {
    mocks.openAIConstructor(config);

    return {
      chat: { completions: { create: mocks.gatewayChatCreate } },
      embeddings: { create: mocks.gatewayEmbeddingsCreate },
    };
  }

  return { default: OpenAI };
});

describe('FundEU AI gateway consumer contract', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    mocks.gatewayChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'gateway-response' } }],
      usage: { total_tokens: 23 },
    });
    mocks.gatewayEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [0.11, 0.22, 0.33] }],
      usage: { total_tokens: 9 },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails closed when gateway config is absent', async () => {
    delete process.env.AI_GATEWAY_URL;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_KEY;

    const { aiGenerate } = await import('@/lib/ai/client');
    await expect(aiGenerate({
      system: 'You are helpful.',
      prompt: 'Draft a funding summary.',
    })).rejects.toThrow(/AI gateway is required/i);
    expect(mocks.openAIConstructor).not.toHaveBeenCalled();
  });

  it('uses the gateway chat completions contract when configured', async () => {
    process.env.AI_GATEWAY_URL = 'https://gateway.example.com/';
    process.env.AI_GATEWAY_API_KEY = 'gateway-secret';

    const { aiGenerate } = await import('@/lib/ai/client');
    const response = await aiGenerate({
      system: 'You are helpful.',
      prompt: 'Draft a funding summary.',
      maxTokens: 123,
      temperature: 0.2,
    });

    expect(mocks.openAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'gateway-secret',
        baseURL: 'https://gateway.example.com/v1',
      }),
    );
    expect(mocks.gatewayChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.any(String),
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Draft a funding summary.' },
        ],
        max_tokens: 123,
        temperature: 0.2,
      }),
    );
    expect(response).toEqual({ text: 'gateway-response', tokensUsed: 23 });
  });

  it('fails closed when gateway chat fails', async () => {
    process.env.AI_GATEWAY_URL = 'https://gateway.example.com';
    process.env.AI_GATEWAY_API_KEY = 'gateway-secret';
    mocks.gatewayChatCreate.mockRejectedValue(new Error('gateway down'));

    const { aiGenerate } = await import('@/lib/ai/client');
    await expect(aiGenerate({
      system: 'You are helpful.',
      prompt: 'Draft a funding summary.',
    })).rejects.toThrow(/AI gateway request failed/i);

    expect(mocks.gatewayChatCreate).toHaveBeenCalled();
  }, 15000);

  it('sends x-tenant-id header in OpenAI constructor defaultHeaders', async () => {
    process.env.AI_GATEWAY_URL = 'https://gateway.example.com';
    process.env.AI_GATEWAY_API_KEY = 'gateway-secret';

    const { aiGenerate } = await import('@/lib/ai/client');
    await aiGenerate({ system: 'test', prompt: 'test' });

    expect(mocks.openAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHeaders: expect.objectContaining({
          'x-tenant-id': 'fondeu-platform',
        }),
      }),
    );
  });

  it('defaults analysis model to gpt-4o (not gpt-4o-mini)', async () => {
    delete process.env.AI_ANALYSIS_MODEL;

    const { AI_CONFIG } = await import('@/lib/ai/config');
    expect(AI_CONFIG.analysis.model).toBe('gpt-4o');
  });

  it('allows AI_ANALYSIS_MODEL env var to override default', async () => {
    process.env.AI_ANALYSIS_MODEL = 'gpt-5.3-instant';

    const { AI_CONFIG } = await import('@/lib/ai/config');
    expect(AI_CONFIG.analysis.model).toBe('gpt-5.3-instant');
  });

  it('uses the gateway embeddings contract when configured', async () => {
    process.env.AI_GATEWAY_URL = 'https://gateway.example.com';
    process.env.AI_GATEWAY_KEY = 'gateway-secret';

    const { aiEmbed } = await import('@/lib/ai/client');
    const response = await aiEmbed('eligible municipality project');

    expect(mocks.gatewayEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.any(String),
        input: 'eligible municipality project',
        dimensions: 1536,
      }),
    );
    expect(response).toEqual({ embedding: [0.11, 0.22, 0.33], tokensUsed: 9 });
  });
});
