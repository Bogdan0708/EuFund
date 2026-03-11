// ─── AI Orchestrator - Gateway-Only Interface ────────────────────────
// Central orchestrator that manages the ai-gateway, caching, and monitoring.

import { ProviderRegistry, BaseAIProvider } from './providers/base';
import { AIGatewayProvider } from './providers/gateway';
import { AICache, getAICache, shouldCache } from './cache';
import { 
  optimizeForRomanianContext, 
  recordRomanianPerformance,
  analyzeRomanianContext,
  getRomanianPerformanceMetrics,
  type RomanianOptimizedRequest 
} from './romanian-specialization';
import { 
  AIProvider, 
  AIRequest, 
  AIResponse, 
  AIProviderError,
  UsageMetrics,
  AIRouterConfig
} from './types';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'ai-orchestrator' });

export class AIOrchestrator {
  private registry: ProviderRegistry;
  private cache: AICache;
  private config: AIRouterConfig;
  private usageMetrics: Map<string, UsageMetrics> = new Map();

  constructor(config: AIRouterConfig) {
    this.config = config;
    this.registry = new ProviderRegistry();
    this.cache = getAICache({ enabled: config.enableCaching });
    
    this.initializeProviders();
  }

  public async generateText(request: AIRequest): Promise<AIResponse> {
    try {
      const optimizedRequest = optimizeForRomanianContext(request);
      const isRomanianOptimized = 'romanianContext' in optimizedRequest;

      if (shouldCache(optimizedRequest) && this.cache.isEnabled()) {
        const cached = await this.cache.get(optimizedRequest);
        if (cached) {
          this.recordUsage(optimizedRequest, cached);
          return cached;
        }
      }

      const provider = this.requireGatewayProvider();
      const response = await provider.generateText(optimizedRequest);

      if (shouldCache(optimizedRequest) && this.cache.isEnabled()) {
        await this.cache.set(optimizedRequest, response);
      }

      this.recordUsage(optimizedRequest, response);

      if (isRomanianOptimized) {
        const usedRomanianProvider = response.provider === 'openllm-ro';
        recordRomanianPerformance(
          optimizedRequest as RomanianOptimizedRequest, 
          response, 
          usedRomanianProvider
        );
      }
      
      return response;

    } catch (error: unknown) {
      log.error({ error }, 'AI Orchestrator error');
      throw error;
    }
  }

  public async generateObject<T>(
    request: AIRequest & { schema: unknown }
  ): Promise<AIResponse & { object: T }> {
    try {
      const provider = this.requireGatewayProvider();
      const response = await provider.generateObject<T>(request) as AIResponse & { object: T };

      this.recordUsage(request, response);
      return response;

    } catch (error: unknown) {
      log.error({ error }, 'AI Orchestrator structured error');
      throw error;
    }
  }

  public async embed(text: string, provider?: AIProvider): Promise<number[]> {
    try {
      const targetProvider = provider || AIProvider.AI_GATEWAY;
      if (targetProvider !== AIProvider.AI_GATEWAY) {
        throw new AIProviderError(targetProvider, 'not-allowed', 'FundEU embeddings must use ai-gateway', false);
      }
      const providerInstance = this.registry.get(targetProvider);
      
      if (!providerInstance) {
        throw new AIProviderError(targetProvider, 'not-available', 'Provider not configured', false);
      }

      return await providerInstance.embed(text);

    } catch (error: unknown) {
      log.error({ error }, 'AI Orchestrator embedding error');
      throw error;
    }
  }

  public async getHealthStatus(): Promise<{
    healthy: boolean;
    providers: Array<{
      provider: AIProvider;
      healthy: boolean;
      latency?: number;
    }>;
    cache: {
      enabled: boolean;
      stats: unknown;
    };
  }> {
    const providers = [];
    
    for (const providerInstance of this.registry.getAll()) {
      const startTime = Date.now();
      try {
        const healthy = await providerInstance.isHealthy();
        providers.push({
          provider: providerInstance.provider,
          healthy,
          latency: healthy ? Date.now() - startTime : undefined
        });
      } catch {
        providers.push({
          provider: providerInstance.provider,
          healthy: false
        });
      }
    }

    const healthyCount = providers.filter(p => p.healthy).length;
    const cacheStats = this.cache.isEnabled() ? await this.cache.getStats() : {};

    return {
      healthy: healthyCount > 0,
      providers,
      cache: {
        enabled: this.cache.isEnabled(),
        stats: cacheStats
      }
    };
  }

  public getUsageMetrics(timeWindow: '1h' | '24h' | '7d' | '30d' = '24h'): UsageMetrics[] {
    return Array.from(this.usageMetrics.values())
      .filter(metric => metric.timeWindow === timeWindow);
  }

  public async clearCache(pattern?: string): Promise<number> {
    if (!this.cache.isEnabled()) return 0;
    return await this.cache.invalidate(pattern || '*');
  }

  public getRomanianPerformanceMetrics() {
    return getRomanianPerformanceMetrics();
  }

  public analyzeRomanianContent(text: string) {
    return analyzeRomanianContext(text);
  }

  private requireGatewayProvider(): BaseAIProvider {
    const provider = this.registry.get(AIProvider.AI_GATEWAY);
    if (!provider) {
      throw new AIProviderError(AIProvider.AI_GATEWAY, 'not-configured', 'AI gateway is not configured', false);
    }
    return provider;
  }

  private initializeProviders(): void {
    const config = this.config.providers[AIProvider.AI_GATEWAY];
    if (!config?.enabled || !config.apiKey || !config.baseURL) {
      log.warn('AI gateway is not fully configured; orchestrator will fail closed');
      return;
    }

    try {
      const provider = new AIGatewayProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: config.timeout,
      });
      this.registry.register(provider);
      log.info('Initialized provider: ai-gateway');
    } catch (error) {
      log.error({ error, provider: AIProvider.AI_GATEWAY }, 'Failed to initialize AI gateway');
    }
  }

  private recordUsage(request: AIRequest, response: AIResponse): void {
    if (!this.config.enableMetrics) return;

    const key = `${response.provider}:${request.taskType}:24h`;
    const existing = this.usageMetrics.get(key) || {
      provider: response.provider,
      taskType: request.taskType,
      requestCount: 0,
      totalCost: 0,
      totalTokens: 0,
      averageLatency: 0,
      successRate: 1,
      timeWindow: '24h' as const
    };

    existing.requestCount++;
    existing.totalCost += response.cost;
    existing.totalTokens += response.tokensUsed.total;
    existing.averageLatency = (existing.averageLatency * (existing.requestCount - 1) + response.latency) / existing.requestCount;

    this.usageMetrics.set(key, existing);
  }
}

// ─── Global Orchestrator Instance ────────────────────────────────────

let globalOrchestrator: AIOrchestrator | null = null;

export function getAIOrchestrator(config?: AIRouterConfig): AIOrchestrator {
  if (!globalOrchestrator && config) {
    globalOrchestrator = new AIOrchestrator(config);
  } else if (!globalOrchestrator) {
    throw new Error('AI Orchestrator not initialized. Provide config on first call.');
  }
  return globalOrchestrator;
}

// ─── Helper Functions ────────────────────────────────────────────────

export function createDefaultConfig(): AIRouterConfig {
  return {
    providers: {
      [AIProvider.AI_GATEWAY]: {
        provider: AIProvider.AI_GATEWAY,
        model: 'auto',
        apiKey: process.env.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_KEY || '',
        baseURL: process.env.AI_GATEWAY_URL || 'https://ai-gateway-382299704849.europe-central2.run.app',
        timeout: 30000,
        maxRetries: 3,
        enabled: !!(process.env.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_KEY)
      },
    },
    routingStrategy: 'balanced',
    enableCaching: true,
    cacheProvider: 'redis',
    enableCircuitBreaker: true,
    enableMetrics: true,
    defaultFallbacks: []
  };
}
