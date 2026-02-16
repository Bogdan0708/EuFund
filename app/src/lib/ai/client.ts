// ─── AI Client with Circuit Breaker ──────────────────────────────
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, generateObject, embed } from 'ai';
import { z } from 'zod';
import { CircuitBreaker, Errors, withRetry } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { AI_CONFIG } from './config';
const log = logger.child({ component: 'ai-client' });

// OpenAI provider instance
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Circuit breakers per service
const generationBreaker = new CircuitBreaker('ai-generation', 5, 60000);
const analysisBreaker = new CircuitBreaker('ai-analysis', 5, 60000);
const embeddingBreaker = new CircuitBreaker('ai-embedding', 5, 60000);

/**
 * Generate text with retry + circuit breaker
 */
export async function aiGenerate(opts: {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ text: string; tokensUsed: number }> {
  const startTime = performance.now();
  try {
    return await generationBreaker.execute(() =>
      withRetry(async () => {
        const result = await generateText({
          model: openai(AI_CONFIG.generation.model),
          system: opts.system,
          prompt: opts.prompt,
          temperature: opts.temperature ?? AI_CONFIG.generation.temperature,
          maxOutputTokens: opts.maxTokens ?? AI_CONFIG.generation.maxTokens,
          abortSignal: AbortSignal.timeout(30000),
        });
        return {
          text: result.text,
          tokensUsed: (result.usage?.totalTokens) ?? 0,
        };
      })
    );
  } finally {
    log.info({ operation: 'aiGenerate', durationMs: Number((performance.now() - startTime).toFixed(2)) }, 'AI call completed');
  }
}

/**
 * Generate structured output with schema validation
 */
export async function aiGenerateObject<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
  schemaName: string;
  temperature?: number;
}): Promise<{ object: z.infer<T>; tokensUsed: number }> {
  const startTime = performance.now();
  try {
    return await analysisBreaker.execute(() =>
      withRetry(async () => {
        const result = await generateObject({
          model: openai(AI_CONFIG.analysis.model),
          system: opts.system,
          prompt: opts.prompt,
          schema: opts.schema,
          schemaName: opts.schemaName,
          temperature: opts.temperature ?? AI_CONFIG.analysis.temperature,
          abortSignal: AbortSignal.timeout(30000),
        });
        return {
          object: result.object as z.infer<T>,
          tokensUsed: (result.usage?.totalTokens) ?? 0,
        };
      })
    );
  } finally {
    log.info({ operation: 'aiGenerateObject', durationMs: Number((performance.now() - startTime).toFixed(2)) }, 'AI call completed');
  }
}

/**
 * Generate embeddings for text
 */
export async function aiEmbed(text: string): Promise<{ embedding: number[]; tokensUsed: number }> {
  const startTime = performance.now();
  try {
    return await embeddingBreaker.execute(() =>
      withRetry(async () => {
        const result = await embed({
          model: openai.embedding(AI_CONFIG.embedding.model),
          value: text,
          abortSignal: AbortSignal.timeout(30000),
        });
        return {
          embedding: result.embedding as number[],
          tokensUsed: (result.usage?.tokens) ?? 0,
        };
      })
    );
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

  // Process in batches of 20
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
