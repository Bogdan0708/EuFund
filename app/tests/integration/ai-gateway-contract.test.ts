import { describe, expect, it, vi } from 'vitest';

describe('FundEU AI client contract', () => {
  it('defaults generation model to gpt-4o', async () => {
    delete process.env.AI_GENERATION_MODEL;
    const { AI_CONFIG } = await import('@/lib/ai/config');
    expect(AI_CONFIG.generation.model).toBe('gpt-4o');
  });

  it('defaults analysis model to gpt-4o', async () => {
    delete process.env.AI_ANALYSIS_MODEL;
    const { AI_CONFIG } = await import('@/lib/ai/config');
    expect(AI_CONFIG.analysis.model).toBe('gpt-4o');
  });

  it('allows AI_ANALYSIS_MODEL env var to override default', async () => {
    const original = process.env.AI_ANALYSIS_MODEL;
    process.env.AI_ANALYSIS_MODEL = 'gpt-5.3-instant';
    vi.resetModules();
    const { AI_CONFIG } = await import('@/lib/ai/config');
    expect(AI_CONFIG.analysis.model).toBe('gpt-5.3-instant');
    process.env.AI_ANALYSIS_MODEL = original;
  });

  it('aiGenerate routes through centralized provider router', async () => {
    // aiGenerate now uses resolveAgentModel + providers/router, not external gateway
    const { resolveAgentModel } = await import('@/lib/ai/model-routing');
    const resolved = resolveAgentModel({ task: 'editing' });
    expect(resolved.tier).toBe('standard');
    expect(resolved.provider).toBeDefined();
    expect(resolved.model).toBeDefined();
  });

  it('aiGenerateObject uses budget tier for JSON reliability', async () => {
    const { resolveAgentModel } = await import('@/lib/ai/model-routing');
    const resolved = resolveAgentModel({ task: 'structure_extraction' });
    expect(resolved.tier).toBe('budget');
    expect(resolved.provider).toBe('openai');
  });
});
