// ─── AI Orchestrator - Main Multi-Provider Interface ─────────────────
// Central orchestrator that manages all AI providers, routing, caching, and monitoring

import { AIRouter } from './router';
import { ProviderRegistry, BaseAIProvider } from './providers/base';
import { OpenAIProvider } from './providers/openai';
import { ClaudeProvider } from './providers/claude';
import { GoogleProvider } from './providers/google';
import { RomanianProvider } from './providers/romanian';
import { AIGatewayProvider } from './providers/gateway';
import { PerplexityProvider } from './providers/perplexity';
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
  RoutingDecision, 
  AIProviderError,
  UsageMetrics,
  AIRouterConfig
} from './types';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'ai-orchestrator' });

export class AIOrchestrator {
  private router: AIRouter;
  private registry: ProviderRegistry;
  private cache: AICache;
  private config: AIRouterConfig;
  private usageMetrics: Map<string, UsageMetrics> = new Map();

  constructor(config: AIRouterConfig) {
    this.config = config;
    this.router = new AIRouter({
      enableCircuitBreaker: config.enableCircuitBreaker,
      maxFailures: 3,
      circuitBreakerTimeoutMs: 300000,
      enableCaching: config.enableCaching
    });
    this.registry = new ProviderRegistry();
    this.cache = getAICache({ enabled: config.enableCaching });
    
    this.initializeProviders();
  }

  public async generateText(request: AIRequest): Promise<AIResponse> {
    try {
      // 1. Romanian Context Optimization
      const optimizedRequest = optimizeForRomanianContext(request);
      const isRomanianOptimized = 'romanianContext' in optimizedRequest;
      
      // 2. Check cache first
      if (shouldCache(optimizedRequest) && this.cache.isEnabled()) {
        const cached = await this.cache.get(optimizedRequest);
        if (cached) {
          this.recordUsage(optimizedRequest, cached);
          return cached;
        }
      }

      // 3. Get routing decision (with Romanian optimization)
      const routing = await this.router.routeRequest(optimizedRequest);
      
      // 4. Execute request with fallbacks
      const response = await this.executeWithFallback(optimizedRequest, routing) as AIResponse;
      
      // 5. Cache successful response
      if (shouldCache(optimizedRequest) && this.cache.isEnabled()) {
        await this.cache.set(optimizedRequest, response);
      }
      
      // 6. Record metrics and Romanian performance
      this.recordUsage(optimizedRequest, response);
      this.router.reportSuccess(routing.selectedProvider);
      
      // 7. Romanian performance tracking
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
      
      // Record failure for circuit breaker
      if (error instanceof AIProviderError) {
        this.router.reportFailure(error.provider as AIProvider);
      }
      
      throw error;
    }
  }

  public async generateObject<T>(
    request: AIRequest & { schema: unknown }
  ): Promise<AIResponse & { object: T }> {
    try {
      // Structured output is generally not cached due to complexity
      const routing = await this.router.routeRequest(request);
      const response = await this.executeObjectWithFallback(request, routing) as AIResponse & { object: T };
      
      this.recordUsage(request, response);
      this.router.reportSuccess(routing.selectedProvider);
      
      return response;

    } catch (error: unknown) {
      log.error({ error }, 'AI Orchestrator structured error');
      
      if (error instanceof AIProviderError) {
        this.router.reportFailure(error.provider as AIProvider);
      }
      
      throw error;
    }
  }

  public async embed(text: string, provider?: AIProvider): Promise<number[]> {
    try {
      // Embeddings use specific providers (OpenAI or Google)
      const targetProvider = provider || AIProvider.OPENAI;
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

  private async executeWithFallback(
    request: AIRequest, 
    routing: RoutingDecision
  ): Promise<AIResponse> {
    const providers = [
      routing.selectedProvider,
      ...routing.fallbackProviders.map(f => f.provider)
    ];

    let lastError: Error | null = null;

    for (const providerType of providers) {
      const provider = this.registry.get(providerType);
      if (!provider) continue;

      try {
        return await provider.generateText(request);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error('Unknown provider error');
        
        // Don't retry on non-retryable errors
        if (error instanceof AIProviderError && !error.retryable) {
          throw error;
        }
        
        // Continue to next provider
        const message = error instanceof Error ? error.message : 'Unknown provider error';
        log.warn({ provider: providerType, error: message }, 'Provider failed, trying next');
      }
    }

    throw lastError || new Error('All providers failed');
  }

  private async executeObjectWithFallback<T>(
    request: AIRequest & { schema: unknown }, 
    routing: RoutingDecision
  ): Promise<AIResponse & { object: T }> {
    const providers = [
      routing.selectedProvider,
      ...routing.fallbackProviders.map(f => f.provider)
    ];

    let lastError: Error | null = null;

    for (const providerType of providers) {
      const provider = this.registry.get(providerType);
      if (!provider) continue;

      try {
        return await provider.generateObject<T>(request) as AIResponse & { object: T };
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error('Unknown provider error');
        
        if (error instanceof AIProviderError && !error.retryable) {
          throw error;
        }
        
        const message = error instanceof Error ? error.message : 'Unknown provider error';
        log.warn({ provider: providerType, error: message }, 'Provider failed for structured output, trying next');
      }
    }

    throw lastError || new Error('All providers failed for structured output');
  }

  private initializeProviders(): void {
    // Initialize providers based on configuration
    for (const [providerType, config] of Object.entries(this.config.providers)) {
      if (!config.enabled || !config.apiKey) continue;

      try {
        let provider: BaseAIProvider;

        switch (providerType as AIProvider) {
          case AIProvider.OPENAI:
            provider = new OpenAIProvider({
              apiKey: config.apiKey,
              baseURL: config.baseURL,
              timeout: config.timeout
            });
            break;

          case AIProvider.ANTHROPIC:
            provider = new ClaudeProvider({
              apiKey: config.apiKey,
              baseURL: config.baseURL,
              timeout: config.timeout
            });
            break;

          case AIProvider.GOOGLE:
            provider = new GoogleProvider({
              apiKey: config.apiKey,
              baseURL: config.baseURL,
              timeout: config.timeout
            });
            break;

          case AIProvider.OPENLLM_RO:
            provider = new RomanianProvider({
              apiKey: config.apiKey,
              baseURL: config.baseURL,
              timeout: config.timeout
            });
            break;

          case AIProvider.AI_GATEWAY:
            if (!config.baseURL) {
              log.warn('AI Gateway requires baseURL, skipping');
              continue;
            }
            provider = new AIGatewayProvider({
              apiKey: config.apiKey,
              baseURL: config.baseURL,
              timeout: config.timeout
            });
            break;

          case AIProvider.PERPLEXITY:
            provider = new PerplexityProvider({
              apiKey: config.apiKey,
              baseURL: config.baseURL,
              timeout: config.timeout
            });
            break;

          default:
            log.warn(`Unknown provider type: ${providerType}`);
            continue;
        }

        this.registry.register(provider);
        log.info(`Initialized provider: ${providerType}`);

      } catch (error) {
        log.error({ error, provider: providerType }, `Failed to initialize provider ${providerType}`);
      }
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
      [AIProvider.OPENAI]: {
        provider: AIProvider.OPENAI,
        model: 'gpt-4o',
        apiKey: process.env.OPENAI_API_KEY || '',
        timeout: 30000,
        maxRetries: 3,
        enabled: !!process.env.OPENAI_API_KEY
      },
      [AIProvider.ANTHROPIC]: {
        provider: AIProvider.ANTHROPIC,
        model: 'claude-3-5-sonnet-20241022',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        timeout: 30000,
        maxRetries: 3,
        enabled: !!process.env.ANTHROPIC_API_KEY
      },
      [AIProvider.GOOGLE]: {
        provider: AIProvider.GOOGLE,
        model: 'gemini-2.5-flash',
        apiKey: process.env.GOOGLE_AI_API_KEY || '',
        timeout: 30000,
        maxRetries: 3,
        enabled: !!process.env.GOOGLE_AI_API_KEY
      },
      [AIProvider.OPENLLM_RO]: {
        provider: AIProvider.OPENLLM_RO,
        model: 'rollama3-8b-instruct',
        apiKey: process.env.OPENLLM_RO_API_KEY || '',
        baseURL: process.env.OPENLLM_RO_API_URL,
        timeout: 30000,
        maxRetries: 3,
        enabled: !!process.env.OPENLLM_RO_API_KEY
      },
      [AIProvider.AI_GATEWAY]: {
        provider: AIProvider.AI_GATEWAY,
        model: 'auto',
        apiKey: process.env.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_KEY || '',
        baseURL: process.env.AI_GATEWAY_URL || 'https://ai-gateway-382299704849.europe-west2.run.app',
        timeout: 30000,
        maxRetries: 3,
        enabled: !!(process.env.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_KEY)
      },
      [AIProvider.PERPLEXITY]: {
        provider: AIProvider.PERPLEXITY,
        model: 'llama-3.1-sonar-large-128k-online',
        apiKey: process.env.PERPLEXITY_API_KEY || '',
        baseURL: 'https://api.perplexity.ai',
        timeout: 30000,
        maxRetries: 3,
        enabled: !!process.env.PERPLEXITY_API_KEY
      }
    },
    routingStrategy: 'balanced',
    enableCaching: true,
    cacheProvider: 'redis',
    enableCircuitBreaker: true,
    enableMetrics: true,
    defaultFallbacks: [AIProvider.OPENAI, AIProvider.GOOGLE]
  };
}
