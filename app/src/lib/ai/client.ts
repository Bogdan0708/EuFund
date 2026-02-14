// ─── AI Client with Circuit Breaker ──────────────────────────────
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, generateObject, embed } from 'ai';
import { z } from 'zod';
import { CircuitBreaker, Errors, withRetry } from '@/lib/errors';
import { AI_CONFIG } from './config';

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
  return generationBreaker.execute(() =>
    withRetry(async () => {
      const result = await generateText({
        model: openai(AI_CONFIG.generation.model),
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? AI_CONFIG.generation.temperature,
        maxOutputTokens: opts.maxTokens ?? AI_CONFIG.generation.maxTokens,
      });
      return {
        text: result.text,
        tokensUsed: (result.usage?.totalTokens) ?? 0,
      };
    })
  );
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
  return analysisBreaker.execute(() =>
    withRetry(async () => {
      const result = await generateObject({
        model: openai(AI_CONFIG.analysis.model),
        system: opts.system,
        prompt: opts.prompt,
        schema: opts.schema,
        schemaName: opts.schemaName,
        temperature: opts.temperature ?? AI_CONFIG.analysis.temperature,
      });
      return {
        object: result.object as z.infer<T>,
        tokensUsed: (result.usage?.totalTokens) ?? 0,
      };
    })
  );
}

/**
 * Generate embeddings for text
 */
export async function aiEmbed(text: string): Promise<{ embedding: number[]; tokensUsed: number }> {
  return embeddingBreaker.execute(() =>
    withRetry(async () => {
      const result = await embed({
        model: openai.embedding(AI_CONFIG.embedding.model),
        value: text,
      });
      return {
        embedding: result.embedding as number[],
        tokensUsed: (result.usage?.tokens) ?? 0,
      };
    })
  );
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
  const endpoint = AI_CONFIG.romanianBert.endpoint;
  const token = process.env.HUGGINGFACE_TOKEN;

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
  });

  if (!response.ok) {
    throw Errors.serviceUnavailable('Romanian BERT');
  }

  return response.json();
}
