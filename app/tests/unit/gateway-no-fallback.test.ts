// app/tests/unit/gateway-no-fallback.test.ts
//
// Regression test for the `noFallback` flag on createGatewayClient().generate().
// The discovery pipeline relies on this — without it, a Perplexity failure
// silently swaps to Gemini and inserts hallucinated "calls" into the DB.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockEmbeddings = vi.fn().mockResolvedValue({ data: [{ embedding: [0.1] }] });

class MockOpenAI {
  chat = { completions: { create: mockCreate } };
  embeddings = { create: mockEmbeddings };
}

vi.mock('openai', () => ({ default: MockOpenAI }));

beforeEach(() => {
  mockCreate.mockReset();
  vi.resetModules();
});

describe('Gateway noFallback flag', () => {
  it('falls back to FALLBACK_PROVIDER when noFallback is omitted (default behavior)', async () => {
    // First two attempts fail (primary + same-provider retry on retryable),
    // then the cross-provider fallback succeeds.
    const err: Error & { status?: number } = Object.assign(new Error('perplexity 503'), { status: 503 });
    mockCreate
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'fallback-response' } }],
        usage: { total_tokens: 50 },
      });

    const { createGatewayClient } = await import('@/lib/ai/gateway');
    const client = createGatewayClient('test');
    const result = await client.generate({
      provider: 'perplexity',
      model: 'sonar',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.content).toBe('fallback-response');
    // Three total: primary, retry, fallback.
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('falls back when noFallback is explicitly false', async () => {
    const err: Error & { status?: number } = Object.assign(new Error('perplexity 503'), { status: 503 });
    mockCreate
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'fallback-response' } }],
        usage: { total_tokens: 50 },
      });

    const { createGatewayClient } = await import('@/lib/ai/gateway');
    const client = createGatewayClient('test');
    const result = await client.generate({
      provider: 'perplexity',
      model: 'sonar',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      noFallback: false,
    });

    expect(result.content).toBe('fallback-response');
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('rethrows the retry error when noFallback=true (skips cross-provider swap)', async () => {
    const err: Error & { status?: number } = Object.assign(new Error('perplexity 503'), { status: 503 });
    mockCreate
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err);
    // No third call should occur — the fallback path must be skipped.

    const { createGatewayClient } = await import('@/lib/ai/gateway');
    const client = createGatewayClient('test');

    await expect(
      client.generate({
        provider: 'perplexity',
        model: 'sonar',
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        noFallback: true,
      }),
    ).rejects.toThrow(/perplexity 503/);

    // Primary + same-provider retry only; never the fallback provider.
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('rethrows on a non-retryable error when noFallback=true (no retry, no fallback)', async () => {
    // 400 is non-retryable — single primary call, then immediate rethrow.
    const err: Error & { status?: number } = Object.assign(new Error('perplexity 400'), { status: 400 });
    mockCreate.mockRejectedValueOnce(err);

    const { createGatewayClient } = await import('@/lib/ai/gateway');
    const client = createGatewayClient('test');

    await expect(
      client.generate({
        provider: 'perplexity',
        model: 'sonar',
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        noFallback: true,
      }),
    ).rejects.toThrow(/perplexity 400/);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('still allows same-provider retry when noFallback=true if the retry succeeds', async () => {
    // noFallback should NOT disable the same-provider retry — only the
    // cross-provider swap. A transient 503 followed by success must still work.
    const err: Error & { status?: number } = Object.assign(new Error('perplexity 503'), { status: 503 });
    mockCreate
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'retry-success' } }],
        usage: { total_tokens: 25 },
      });

    const { createGatewayClient } = await import('@/lib/ai/gateway');
    const client = createGatewayClient('test');
    const result = await client.generate({
      provider: 'perplexity',
      model: 'sonar',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      noFallback: true,
    });

    expect(result.content).toBe('retry-success');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
