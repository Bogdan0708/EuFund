import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openAIConstructor: vi.fn(),
  gatewayChatCreate: vi.fn(),
  gatewayEmbeddingsCreate: vi.fn(),
  orchestratorGenerateText: vi.fn(),
  orchestratorGenerateObject: vi.fn(),
  orchestratorEmbed: vi.fn(),
  createDefaultConfig: vi.fn(() => ({ providers: {} })),
  getAIOrchestrator: vi.fn(),
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

vi.mock('@/lib/ai/orchestrator', () => ({
  createDefaultConfig: mocks.createDefaultConfig,
  getAIOrchestrator: mocks.getAIOrchestrator.mockImplementation(() => ({
    generateText: mocks.orchestratorGenerateText,
    generateObject: mocks.orchestratorGenerateObject,
    embed: mocks.orchestratorEmbed,
  })),
}));

describe('FundEU AI gateway consumer contract', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    mocks.orchestratorGenerateText.mockResolvedValue({
      content: 'direct-response',
      tokensUsed: { total: 17 },
    });
    mocks.orchestratorEmbed.mockResolvedValue([0.91, 0.42]);
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

  it('falls back to direct orchestration when gateway config is absent', async () => {
    delete process.env.AI_GATEWAY_URL;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_KEY;

    const { aiGenerate } = await import('@/lib/ai/client');
    const response = await aiGenerate({
      system: 'You are helpful.',
      prompt: 'Draft a funding summary.',
    });

    expect(mocks.openAIConstructor).not.toHaveBeenCalled();
    expect(mocks.orchestratorGenerateText).toHaveBeenCalledOnce();
    expect(response).toEqual({ text: 'direct-response', tokensUsed: 17 });
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
    expect(mocks.orchestratorGenerateText).not.toHaveBeenCalled();
    expect(response).toEqual({ text: 'gateway-response', tokensUsed: 23 });
  });

  it('falls back to direct orchestration when gateway chat fails', async () => {
    process.env.AI_GATEWAY_URL = 'https://gateway.example.com';
    process.env.AI_GATEWAY_API_KEY = 'gateway-secret';
    mocks.gatewayChatCreate.mockRejectedValueOnce(new Error('gateway down'));

    const { aiGenerate } = await import('@/lib/ai/client');
    const response = await aiGenerate({
      system: 'You are helpful.',
      prompt: 'Draft a funding summary.',
    });

    expect(mocks.gatewayChatCreate).toHaveBeenCalledOnce();
    expect(mocks.orchestratorGenerateText).toHaveBeenCalledOnce();
    expect(response).toEqual({ text: 'direct-response', tokensUsed: 17 });
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
    expect(mocks.orchestratorEmbed).not.toHaveBeenCalled();
    expect(response).toEqual({ embedding: [0.11, 0.22, 0.33], tokensUsed: 9 });
  });
});
