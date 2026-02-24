// ─── Multi-Provider AI Client V2 ─────────────────────────────────────
// Unified interface that replaces the existing single-provider client
// Provides backward compatibility while enabling multi-provider routing

import { z } from 'zod';
import { getAIOrchestrator, createDefaultConfig } from './orchestrator';
import { TaskType, AIRequest } from './types';

// ─── Backward Compatibility Interface ────────────────────────────────

export interface AIGenerateOptions {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  taskType?: TaskType; // New: allows optimization
  userTier?: 'free' | 'pro' | 'enterprise'; // New: for tier-based routing
  userId?: string; // New: for usage tracking
  language?: 'ro' | 'en' | 'auto'; // New: language optimization
  priority?: 'low' | 'normal' | 'high'; // New: priority routing
  cacheKey?: string; // New: custom cache key
}

export interface AIGenerateObjectOptions<T extends z.ZodType> extends AIGenerateOptions {
  schema: T;
  structuredOutput?: boolean;
}

// ─── Main Client Functions ───────────────────────────────────────────

/**
 * Generate text with retry + circuit breaker + multi-provider routing
 * Drop-in replacement for existing aiGenerate function
 */
export async function aiGenerate(opts: AIGenerateOptions): Promise<{ 
  text: string; 
  tokensUsed: number;
  provider?: string;
  model?: string;
  cost?: number;
  cached?: boolean;
}> {
  const orchestrator = getAIOrchestrator(createDefaultConfig());
  
  const request: AIRequest = {
    taskType: opts.taskType || TaskType.SIMPLE_TEXT_GENERATION,
    prompt: opts.prompt,
    systemPrompt: opts.system,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    userTier: opts.userTier || 'free',
    userId: opts.userId || 'anonymous',
    language: opts.language || 'auto',
    priority: opts.priority || 'normal',
    cacheKey: opts.cacheKey
  };

  const response = await orchestrator.generateText(request);

  return {
    text: response.content,
    tokensUsed: response.tokensUsed.total,
    provider: response.provider,
    model: response.model,
    cost: response.cost,
    cached: response.cached
  };
}

/**
 * Generate structured output with schema validation + multi-provider routing
 * Drop-in replacement for existing aiGenerateObject function
 */
export async function aiGenerateObject<T extends z.ZodType>(opts: AIGenerateObjectOptions<T>): Promise<{
  object: z.infer<T>;
  tokensUsed: number;
  provider?: string;
  model?: string;
  cost?: number;
  cached?: boolean;
}> {
  const orchestrator = getAIOrchestrator(createDefaultConfig());
  
  const request: AIRequest & { schema: unknown } = {
    taskType: opts.taskType || TaskType.SIMPLE_TEXT_GENERATION,
    prompt: opts.prompt,
    systemPrompt: opts.system,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    userTier: opts.userTier || 'free',
    userId: opts.userId || 'anonymous',
    language: opts.language || 'auto',
    priority: opts.priority || 'normal',
    structuredOutput: true,
    schema: opts.schema._def // Zod schema definition
  };

  const response = await orchestrator.generateObject<z.infer<T>>(request);

  return {
    object: response.object,
    tokensUsed: response.tokensUsed.total,
    provider: response.provider,
    model: response.model,
    cost: response.cost,
    cached: response.cached
  };
}

/**
 * Generate embeddings with provider selection
 * Enhanced version of existing aiEmbed function
 */
export async function aiEmbed(text: string, options?: {
  provider?: 'openai' | 'google';
}): Promise<number[]> {
  const orchestrator = getAIOrchestrator(createDefaultConfig());
  
  const providerMap = {
    'openai': 'openai' as import('./types').AIProvider,
    'google': 'google' as import('./types').AIProvider
  };
  
  const provider = options?.provider ? providerMap[options.provider] : undefined;
  return await orchestrator.embed(text, provider);
}

/**
 * Batch embedding with cost optimization
 * Enhanced version of existing aiEmbedBatch function
 */
export async function aiEmbedBatch(texts: string[], options?: {
  provider?: 'openai' | 'google';
  batchSize?: number;
}): Promise<number[][]> {
  const batchSize = options?.batchSize || 10;
  const results: number[][] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(text => aiEmbed(text, { provider: options?.provider }))
    );
    results.push(...batchResults);
  }
  
  return results;
}

// ─── Advanced Features ───────────────────────────────────────────────

/**
 * Romanian-optimized text generation with cultural context
 */
export async function aiGenerateRomanian(opts: Omit<AIGenerateOptions, 'language'> & {
  culturalContext?: 'formal' | 'academic' | 'bureaucratic' | 'business' | 'casual';
}): Promise<{ 
  text: string; 
  tokensUsed: number;
  provider?: string;
  confidence?: number;
  romanianOptimization?: {
    detected: boolean;
    context: string;
    optimizations: string[];
  };
}> {
  const orchestrator = getAIOrchestrator(createDefaultConfig());
  
  // Analyze Romanian context before generation
  const fullText = `${opts.system} ${opts.prompt}`.trim();
  const romanianAnalysis = orchestrator.analyzeRomanianContent(fullText);

  const result = await aiGenerate({
    ...opts,
    language: 'ro',
    taskType: opts.taskType || TaskType.ROMANIAN_LOCALIZATION
  });

  return {
    ...result,
    romanianOptimization: {
      detected: romanianAnalysis.isRomanian,
      context: romanianAnalysis.culturalContext,
      optimizations: romanianAnalysis.recommendations.culturalAdaptations
    }
  };
}

/**
 * Cost-optimized generation for free tier users
 */
export async function aiGenerateEconomical(opts: AIGenerateOptions): Promise<{ 
  text: string; 
  tokensUsed: number;
  estimatedCost: number;
  actualCost?: number;
}> {
  const result = await aiGenerate({
    ...opts,
    userTier: 'free',
    taskType: opts.taskType || TaskType.SIMPLE_TEXT_GENERATION
  });

  return {
    text: result.text,
    tokensUsed: result.tokensUsed,
    estimatedCost: result.cost || 0,
    actualCost: result.cost
  };
}

/**
 * High-priority generation for time-sensitive tasks
 */
export async function aiGenerateUrgent(opts: AIGenerateOptions): Promise<{ 
  text: string; 
  tokensUsed: number;
  latency: number;
  provider?: string;
}> {
  const startTime = Date.now();
  
  const result = await aiGenerate({
    ...opts,
    priority: 'high',
    userTier: opts.userTier || 'pro'
  });

  return {
    text: result.text,
    tokensUsed: result.tokensUsed,
    latency: Date.now() - startTime,
    provider: result.provider
  };
}

// ─── Health and Monitoring ───────────────────────────────────────────

/**
 * Get AI system health status
 */
export async function getAIHealthStatus(): Promise<{
  healthy: boolean;
  providers: Array<{
    name: string;
    healthy: boolean;
    latency?: number;
  }>;
  cache: {
    enabled: boolean;
    hitRate?: number;
    entries?: number;
  };
}> {
  const orchestrator = getAIOrchestrator(createDefaultConfig());
  const health = await orchestrator.getHealthStatus();
  const cacheStats = health.cache.stats as { hitRate?: number; totalEntries?: number } | undefined;

  return {
    healthy: health.healthy,
    providers: health.providers.map(p => ({
      name: p.provider,
      healthy: p.healthy,
      latency: p.latency
    })),
    cache: {
      enabled: health.cache.enabled,
      hitRate: cacheStats?.hitRate,
      entries: cacheStats?.totalEntries
    }
  };
}

/**
 * Get usage analytics and cost tracking
 */
export async function getAIUsageSnapshot(): Promise<{
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  averageLatency: number;
  costSavings: number;
  providerBreakdown: Array<{
    provider: string;
    requests: number;
    cost: number;
    tokens: number;
  }>;
}> {
  const orchestrator = getAIOrchestrator(createDefaultConfig());
  const metrics = orchestrator.getUsageMetrics('24h');

  const totals = metrics.reduce((acc, metric) => {
    acc.totalRequests += metric.requestCount;
    acc.totalCost += metric.totalCost;
    acc.totalTokens += metric.totalTokens;
    acc.latencySum += metric.averageLatency * metric.requestCount;
    return acc;
  }, { totalRequests: 0, totalCost: 0, totalTokens: 0, latencySum: 0 });

  const averageLatency = totals.totalRequests > 0 ? 
    totals.latencySum / totals.totalRequests : 0;

  // Estimate cost savings (compared to OpenAI-only pricing)
  const openAIOnlyCost = totals.totalTokens * 0.002; // Rough estimate
  const costSavings = Math.max(0, openAIOnlyCost - totals.totalCost);

  const providerBreakdown = metrics.map(metric => ({
    provider: metric.provider,
    requests: metric.requestCount,
    cost: metric.totalCost,
    tokens: metric.totalTokens
  }));

  return {
    totalRequests: totals.totalRequests,
    totalCost: totals.totalCost,
    totalTokens: totals.totalTokens,
    averageLatency: Math.round(averageLatency),
    costSavings: Math.round(costSavings * 100) / 100,
    providerBreakdown
  };
}

/**
 * Clear AI response cache
 */
export async function clearAICache(pattern?: string): Promise<number> {
  const orchestrator = getAIOrchestrator(createDefaultConfig());
  return await orchestrator.clearCache(pattern);
}

/**
 * Analyze Romanian content for language and cultural context
 */
export async function analyzeRomanianContent(text: string): Promise<{
  isRomanian: boolean;
  confidence: number;
  culturalContext: string;
  features: {
    hasDiacritics: boolean;
    hasEUTerms: boolean;
    hasLegalTerms: boolean;
  };
  recommendations: string[];
}> {
  const orchestrator = getAIOrchestrator(createDefaultConfig());
  const analysis = orchestrator.analyzeRomanianContent(text);

  return {
    isRomanian: analysis.isRomanian,
    confidence: analysis.confidence,
    culturalContext: analysis.culturalContext,
    features: {
      hasDiacritics: analysis.linguisticFeatures.hasRomanianDiacritics,
      hasEUTerms: analysis.linguisticFeatures.hasEUTerminology,
      hasLegalTerms: analysis.linguisticFeatures.hasLegalTerminology
    },
    recommendations: analysis.recommendations.culturalAdaptations
  };
}

/**
 * Get Romanian AI performance metrics
 */
export async function getRomanianAIMetrics(): Promise<{
  romanianProviderUsage: number;
  costSavings: number;
  languageDetectionAccuracy: number;
  averageLatencyImprovement: number;
}> {
  const orchestrator = getAIOrchestrator(createDefaultConfig());
  const metrics = orchestrator.getRomanianPerformanceMetrics();

  return {
    romanianProviderUsage: metrics.romanianProviderUsage,
    costSavings: metrics.costSavingsFromOptimization,
    languageDetectionAccuracy: metrics.languageDetectionAccuracy,
    averageLatencyImprovement: metrics.averageLatencyImprovement
  };
}

/**
 * Generate EU funding proposal optimized for Romanian context
 */
export async function aiGenerateRomanianEUProposal(opts: AIGenerateOptions & {
  program: 'PNRR' | 'POR' | 'HORIZON_EUROPA' | 'ERASMUS';
  sector: string;
  budget?: number;
}): Promise<{ 
  text: string; 
  tokensUsed: number;
  provider?: string;
  romanianOptimizations: string[];
  programContext: string[];
}> {
  // Import Romanian EU knowledge
  const { getRomanianEUContext } = await import('./romanian-specialization');
  const programContext = getRomanianEUContext(opts.program);

  const enhancedSystemPrompt = `${opts.system}

ROMANIAN EU CONTEXT:
${programContext.join('\n')}

Generate a proposal optimized for Romanian applicants, including:
- Romanian institutional context
- Local partnership opportunities  
- Compliance with Romanian regulations
- Regional development benefits
- Romanian success stories where relevant`;

  const result = await aiGenerateRomanian({
    ...opts,
    system: enhancedSystemPrompt,
    culturalContext: 'formal',
    taskType: TaskType.PROPOSAL_GENERATION
  });

  return {
    text: result.text,
    tokensUsed: result.tokensUsed,
    provider: result.provider,
    romanianOptimizations: result.romanianOptimization?.optimizations || [],
    programContext
  };
}

// ─── Legacy Compatibility ────────────────────────────────────────────

/**
 * Legacy Romanian BERT query (maintained for backward compatibility)
 * Now routes through the multi-provider system
 */
export async function queryRomanianBert(
  text: string,
  task: 'ner' | 'classification' | 'similarity' = 'ner'
): Promise<{ analysis: string; confidence: number; provider?: string }> {
  // Convert to new system
  const taskTypeMap = {
    'ner': TaskType.ROMANIAN_NER,
    'classification': TaskType.COMPLIANCE_CHECK,
    'similarity': TaskType.SEMANTIC_SEARCH
  };

  const result = await aiGenerate({
    system: 'Analyze the following Romanian text and provide structured analysis.',
    prompt: text,
    taskType: taskTypeMap[task],
    language: 'ro',
    userTier: 'pro' // Romanian analysis gets pro tier treatment
  });

  // Return in expected format for backward compatibility
  return {
    analysis: result.text,
    confidence: 0.85, // Placeholder confidence
    provider: result.provider
  };
}

// ─── Export Configuration ────────────────────────────────────────────

export { TaskType } from './types';
export type { AIRequest, AIResponse } from './types';

// Functions are exported individually above
