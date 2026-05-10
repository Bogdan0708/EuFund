// ─── AI Client ──────────────────────────────────────────────────
// Simplified client for endpoints that need one-shot generation
// without full orchestrator/agent infrastructure.
// Uses the centralized routing policy and provider router.

import { z } from 'zod';
import { CircuitBreaker, Errors } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { AI_CONFIG } from './config';
import { resolveAgentModel, type TaskType } from './model-routing';
import { generate } from './providers/router';
import { zodToJsonSchema } from './utils';

const log = logger.child({ component: 'ai-client' });

const generationBreaker = new CircuitBreaker('ai-generation', 5, 60000);
const analysisBreaker = new CircuitBreaker('ai-analysis', 5, 60000);
const embeddingBreaker = new CircuitBreaker('ai-embedding', 5, 60000);

export interface AIGenerateResult<T = string> {
  text?: string;
  object?: T;
  tokensUsed: number;
  provider: string;
  model: string;
  tier: string;
  cached?: boolean;
  romanianOptimized?: boolean;
}

/**
 * Generate text with retry + circuit breaker.
 * Uses centralized routing policy.
 */
export async function aiGenerate(opts: {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  taskType?: TaskType;
  romanianContext?: string;
}): Promise<AIGenerateResult> {
  const startTime = performance.now();
  const resolved = resolveAgentModel({ task: opts.taskType || 'editing' });
  
  const systemPrompt = opts.romanianContext 
    ? `${opts.system}\n\nContext Românesc: ${opts.romanianContext}`
    : opts.system;

  try {
    return await generationBreaker.execute(async () => {
      const response = await generate({
        provider: resolved.provider,
        model: resolved.model,
        system: systemPrompt,
        messages: [{ role: 'user', content: opts.prompt }],
        maxTokens: opts.maxTokens ?? 20_000,
        temperature: opts.temperature ?? AI_CONFIG.generation.temperature,
      });
      return {
        text: response.content,
        tokensUsed: response.tokensUsed.input + response.tokensUsed.output,
        provider: resolved.provider,
        model: resolved.model,
        tier: resolved.tier,
        cached: response.cacheUsage?.hit === 'full' || response.cacheUsage?.hit === 'partial',
        romanianOptimized: !!opts.romanianContext,
      };
    });
  } catch (error) {
    log.error({ error, provider: resolved.provider, model: resolved.model, tier: resolved.tier }, 'AI generation failed');
    throw error;
  } finally {
    log.info({
      operation: 'aiGenerate',
      provider: resolved.provider,
      model: resolved.model,
      tier: resolved.tier,
      durationMs: Number((performance.now() - startTime).toFixed(2)),
    }, 'AI call completed');
  }
}

/**
 * Generate structured output with schema validation.
 * Uses centralized routing policy.
 */
export async function aiGenerateObject<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
  schemaName: string;
  temperature?: number;
  taskType?: TaskType;
  romanianContext?: string;
}): Promise<AIGenerateResult<z.infer<T>>> {
  const startTime = performance.now();
  const resolved = resolveAgentModel({ task: opts.taskType || 'structure_extraction' });
  
  const systemPrompt = opts.romanianContext 
    ? `${opts.system}\n\nContext Românesc: ${opts.romanianContext}`
    : opts.system;

  try {
    return await analysisBreaker.execute(async () => {
      const response = await generate({
        provider: resolved.provider,
        model: resolved.model,
        system: `${systemPrompt}\n\nReturn only valid JSON that matches this schema: ${JSON.stringify(zodToJsonSchema(opts.schema))}`,
        messages: [{ role: 'user', content: opts.prompt }],
        maxTokens: AI_CONFIG.analysis.maxTokens,
        temperature: opts.temperature ?? AI_CONFIG.analysis.temperature,
      });
      const object = opts.schema.parse(JSON.parse(response.content));
      return {
        object,
        tokensUsed: response.tokensUsed.input + response.tokensUsed.output,
        provider: resolved.provider,
        model: resolved.model,
        tier: resolved.tier,
        cached: response.cacheUsage?.hit === 'full' || response.cacheUsage?.hit === 'partial',
        romanianOptimized: !!opts.romanianContext,
      };
    });
  } catch (error) {
    log.error(
      { error, schemaName: opts.schemaName, provider: resolved.provider, model: resolved.model, tier: resolved.tier },
      'AI structured generation failed',
    );
    throw error;
  } finally {
    log.info({
      operation: 'aiGenerateObject',
      provider: resolved.provider,
      model: resolved.model,
      tier: resolved.tier,
      durationMs: Number((performance.now() - startTime).toFixed(2)),
    }, 'AI call completed');
  }
}

/**
 * Generate embeddings for text.
 * Embeddings always use OpenAI (text-embedding-3-small).
 */
export async function aiEmbed(text: string): Promise<{ embedding: number[]; tokensUsed: number }> {
  const startTime = performance.now();
  // Embeddings use OpenAI directly — no routing needed
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    return await embeddingBreaker.execute(async () => {
      const response = await client.embeddings.create({
        model: AI_CONFIG.embedding.model,
        input: text,
        dimensions: AI_CONFIG.embedding.dimensions,
      });
      return {
        embedding: response.data[0]?.embedding || [],
        tokensUsed: response.usage?.total_tokens || Math.ceil(text.length / 4),
      };
    });
  } catch (error) {
    log.error(
      { error, provider: 'openai', model: AI_CONFIG.embedding.model, tier: 'embedding' },
      'Embedding generation failed',
    );
    throw error;
  } finally {
    log.info({ operation: 'aiEmbed', durationMs: Number((performance.now() - startTime).toFixed(2)) }, 'AI call completed');
  }
}

/**
 * Batch embed multiple texts
 */
export async function aiEmbedBatch(texts: string[]): Promise<{ embeddings: number[][]; tokensUsed: number }> {
  let totalTokens = 0;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += 20) {
    const batch = texts.slice(i, i + 20);
    const results = await Promise.all(batch.map((t) => aiEmbed(t)));
    embeddings.push(...results.map((r) => r.embedding));
    totalTokens += results.reduce((sum, r) => sum + r.tokensUsed, 0);
  }

  return { embeddings, tokensUsed: totalTokens };
}

/**
 * Query Romanian BERT model via HuggingFace Inference API
 */
export async function queryRomanianBert(opts: {
  inputs: string;
  task?: 'fill-mask' | 'ner' | 'text-classification';
}): Promise<unknown> {
  const startTime = performance.now();
  const endpoint = AI_CONFIG.romanianBert.endpoint;
  const token = process.env.HUGGINGFACE_TOKEN;

  try {
    if (!token) {
      throw Errors.serviceUnavailable('Romanian BERT (no HuggingFace token configured)');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: opts.inputs }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw Errors.serviceUnavailable('Romanian BERT');
    }

    return response.json();
  } finally {
    log.info({ operation: 'queryRomanianBert', durationMs: Number((performance.now() - startTime).toFixed(2)) }, 'AI call completed');
  }
}
