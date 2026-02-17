// ─── AI Client with Circuit Breaker ──────────────────────────────
import { z } from 'zod';
import { CircuitBreaker, Errors, withRetry } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { AI_CONFIG } from './config';
import { createDefaultConfig, getAIOrchestrator } from './orchestrator';
import { TaskType } from './types';
const log = logger.child({ component: 'ai-client' });

// Circuit breakers per service
const generationBreaker = new CircuitBreaker('ai-generation', 5, 60000);
const analysisBreaker = new CircuitBreaker('ai-analysis', 5, 60000);
const embeddingBreaker = new CircuitBreaker('ai-embedding', 5, 60000);

function resolveTaskType(hintText: string): TaskType {
  const text = hintText.toLowerCase();

  if (text.includes('proposal')) return TaskType.PROPOSAL_GENERATION;
  if (text.includes('risk')) return TaskType.RISK_ASSESSMENT;
  if (text.includes('grant')) return TaskType.GRANT_MATCHING;
  if (text.includes('partner')) return TaskType.PARTNER_MATCHING;
  if (text.includes('budget')) return TaskType.BUDGET_ANALYSIS;
  if (text.includes('timeline')) return TaskType.TIMELINE_OPTIMIZATION;
  if (text.includes('legal')) return TaskType.LEGAL_ANALYSIS;
  if (text.includes('romania') || text.includes('romanian') || text.includes('română') || text.includes('romana')) {
    return TaskType.ROMANIAN_LOCALIZATION;
  }
  if (text.includes('compliance')) return TaskType.COMPLIANCE_CHECK;

  return TaskType.DOCUMENT_ANALYSIS;
}

function getOrchestrator() {
  return getAIOrchestrator(createDefaultConfig());
}

function schemaToJsonSchema(schema: z.ZodType): unknown {
  const zodAny = z as unknown as {
    toJSONSchema?: (value: z.ZodType) => unknown;
  };

  if (typeof zodAny.toJSONSchema === 'function') {
    return zodAny.toJSONSchema(schema);
  }

  return (schema as unknown as { _def?: unknown })._def ?? schema;
}

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
        const orchestrator = getOrchestrator();
        const result = await orchestrator.generateText({
          taskType: resolveTaskType(`${opts.system}\n${opts.prompt}`),
          prompt: opts.prompt,
          systemPrompt: opts.system,
          maxTokens: opts.maxTokens ?? AI_CONFIG.generation.maxTokens,
          temperature: opts.temperature ?? AI_CONFIG.generation.temperature,
          userTier: 'enterprise',
          userId: 'legacy-client',
          language: 'auto',
          priority: 'normal',
        });

        return {
          text: result.content,
          tokensUsed: result.tokensUsed.total,
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
        const orchestrator = getOrchestrator();
        const result = await orchestrator.generateObject<z.infer<T>>({
          taskType: resolveTaskType(`${opts.schemaName}\n${opts.system}\n${opts.prompt}`),
          prompt: opts.prompt,
          systemPrompt: opts.system,
          maxTokens: AI_CONFIG.analysis.maxTokens,
          temperature: opts.temperature ?? AI_CONFIG.analysis.temperature,
          userTier: 'enterprise',
          userId: 'legacy-client',
          language: 'auto',
          priority: 'normal',
          structuredOutput: true,
          schema: schemaToJsonSchema(opts.schema),
        });

        const validatedObject = opts.schema.parse(result.object);

        return {
          object: validatedObject,
          tokensUsed: result.tokensUsed.total,
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
        const orchestrator = getOrchestrator();
        const embedding = await orchestrator.embed(text);
        return {
          embedding,
          tokensUsed: Math.ceil(text.length / 4),
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
