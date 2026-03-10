// ─── Base Provider Interface ─────────────────────────────────────────
// Abstract base class for all AI provider implementations

import { 
  AIProvider, 
  AIRequest, 
  AIResponse, 
  ProviderCapability, 
  AIProviderInterface,
  AIProviderError 
} from '../types';
import { PROVIDER_CAPABILITIES } from '../provider-matrix';

export abstract class BaseAIProvider implements AIProviderInterface {
  public abstract readonly provider: AIProvider;
  protected apiKey: string;
  protected baseURL?: string;
  protected timeout: number = 15000; // 15 seconds default

  constructor(protected config: {
    apiKey: string;
    baseURL?: string;
    timeout?: number;
  }) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.timeout = config.timeout || 15000;
  }

  public abstract generateText(request: AIRequest): Promise<AIResponse>;
  public abstract generateObject<T = unknown>(request: AIRequest & { schema: unknown }): Promise<AIResponse & { object: T }>;
  public abstract embed(text: string): Promise<number[]>;
  public abstract isHealthy(): Promise<boolean>;

  public getCapabilities(): ProviderCapability {
    return PROVIDER_CAPABILITIES[this.provider];
  }

  public estimateCost(request: AIRequest): number {
    const capability = this.getCapabilities();
    const inputTokens = this.estimateInputTokens(request.prompt + (request.systemPrompt || ''));
    const outputTokens = Math.min(request.maxTokens || 1000, 2000);
    
    return (inputTokens / 1000 * capability.costPerToken.input) + 
           (outputTokens / 1000 * capability.costPerToken.output);
  }

  protected estimateInputTokens(text: string): number {
    // Rough estimation: 4 characters per token
    return Math.ceil(text.length / 4);
  }

  protected createResponse(
    content: string,
    model: string,
    tokensUsed: { input: number; output: number },
    startTime: number,
    cached: boolean = false
  ): AIResponse {
    return {
      content,
      provider: this.provider,
      model,
      tokensUsed: {
        input: tokensUsed.input,
        output: tokensUsed.output,
        total: tokensUsed.input + tokensUsed.output
      },
      cost: this.calculateCost(tokensUsed.input, tokensUsed.output),
      latency: Date.now() - startTime,
      cached,
      requestId: this.generateRequestId(),
      timestamp: new Date()
    };
  }

  protected calculateCost(inputTokens: number, outputTokens: number): number {
    const capability = this.getCapabilities();
    return (inputTokens / 1000 * capability.costPerToken.input) + 
           (outputTokens / 1000 * capability.costPerToken.output);
  }

  protected generateRequestId(): string {
    return `${this.provider}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  protected handleError(error: unknown, retryable: boolean = true): never {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new AIProviderError(this.provider, 'unknown', message, retryable);
  }

  protected withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
    const timeout = timeoutMs || this.timeout;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new AIProviderError(
            this.provider, 
            'timeout', 
            `Request timed out after ${timeout}ms`,
            true
          ));
        }, timeout);
      })
    ]);
  }
}

// ─── Provider Registry ───────────────────────────────────────────────

export class ProviderRegistry {
  private providers: Map<AIProvider, BaseAIProvider> = new Map();

  public register(provider: BaseAIProvider): void {
    this.providers.set(provider.provider, provider);
  }

  public get(provider: AIProvider): BaseAIProvider | undefined {
    return this.providers.get(provider);
  }

  public getAll(): BaseAIProvider[] {
    return Array.from(this.providers.values());
  }

  public getHealthy(): Promise<BaseAIProvider[]> {
    return Promise.all(
      Array.from(this.providers.values()).map(async provider => {
        try {
          const healthy = await provider.isHealthy();
          return healthy ? provider : null;
        } catch {
          return null;
        }
      })
    ).then(results => results.filter(Boolean) as BaseAIProvider[]);
  }
}
