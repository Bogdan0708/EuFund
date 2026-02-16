// ─── AI Gateway Provider Implementation ──────────────────────────────
// Gateway to the existing multi-provider AI service

import { BaseAIProvider } from './base';
import { AIProvider, AIRequest, AIResponse, AIProviderError } from '../types';

export class AIGatewayProvider extends BaseAIProvider {
  public readonly provider = AIProvider.AI_GATEWAY;
  private gatewayUrl: string;
  private gatewayApiKey: string;

  constructor(config: {
    apiKey: string; // Gateway API key
    baseURL: string; // Gateway URL
    timeout?: number;
  }) {
    super(config);
    
    this.gatewayApiKey = this.apiKey;
    this.gatewayUrl = this.baseURL || 'https://ai-gateway-382299704849.europe-west2.run.app';
  }

  public async generateText(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      const payload = {
        task_type: request.taskType,
        prompt: request.prompt,
        system_prompt: request.systemPrompt,
        max_tokens: request.maxTokens || 2048,
        temperature: request.temperature || 0.7,
        user_tier: request.userTier,
        language: request.language || 'auto',
        priority: request.priority || 'normal'
      };
      
      const response = await this.withTimeout(
        fetch(`${this.gatewayUrl}/api/v1/generate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.gatewayApiKey}`,
            'Content-Type': 'application/json',
            'X-User-ID': request.userId
          },
          body: JSON.stringify(payload)
        })
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new AIProviderError(this.provider, 'rate-limit', 'Gateway rate limit exceeded', true);
        }
        if (response.status === 401) {
          throw new AIProviderError(this.provider, 'auth', 'Invalid gateway API key', false);
        }
        throw new AIProviderError(this.provider, 'server', `Gateway HTTP ${response.status}`, true);
      }

      const data = await response.json();
      
      if (!data.success || !data.result) {
        throw new AIProviderError(
          this.provider,
          'gateway-error',
          data.error || 'Gateway returned unsuccessful response',
          true
        );
      }

      const result = data.result;
      const tokensUsed = {
        input: result.tokens_used?.input || 0,
        output: result.tokens_used?.output || 0
      };

      // The gateway response includes the actual provider used
      const actualProvider = result.provider || 'unknown';
      const actualModel = result.model || 'auto';
      
      return {
        content: result.content,
        provider: this.provider, // Keep gateway as provider
        model: `${actualProvider}/${actualModel}`, // Show underlying provider
        tokensUsed: {
          input: tokensUsed.input,
          output: tokensUsed.output,
          total: tokensUsed.input + tokensUsed.output
        },
        cost: result.cost || this.calculateCost(tokensUsed.input, tokensUsed.output),
        latency: Date.now() - startTime,
        cached: result.cached || false,
        requestId: result.request_id || this.generateRequestId(),
        timestamp: new Date()
      };

    } catch (error: any) {
      if (error instanceof AIProviderError) throw error;
      this.handleError(error);
    }
  }

  public async generateObject<T>(
    request: AIRequest & { schema: any }
  ): Promise<AIResponse & { object: T }> {
    const startTime = Date.now();
    
    try {
      const payload = {
        task_type: request.taskType,
        prompt: request.prompt,
        system_prompt: request.systemPrompt,
        max_tokens: request.maxTokens || 2048,
        temperature: request.temperature || 0.3,
        user_tier: request.userTier,
        language: request.language || 'auto',
        priority: request.priority || 'normal',
        structured_output: true,
        schema: request.schema
      };
      
      const response = await this.withTimeout(
        fetch(`${this.gatewayUrl}/api/v1/generate-object`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.gatewayApiKey}`,
            'Content-Type': 'application/json',
            'X-User-ID': request.userId
          },
          body: JSON.stringify(payload)
        })
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new AIProviderError(this.provider, 'rate-limit', 'Gateway rate limit exceeded', true);
        }
        if (response.status === 401) {
          throw new AIProviderError(this.provider, 'auth', 'Invalid gateway API key', false);
        }
        throw new AIProviderError(this.provider, 'server', `Gateway HTTP ${response.status}`, true);
      }

      const data = await response.json();
      
      if (!data.success || !data.result) {
        throw new AIProviderError(
          this.provider,
          'gateway-error',
          data.error || 'Gateway returned unsuccessful response',
          true
        );
      }

      const result = data.result;
      const tokensUsed = {
        input: result.tokens_used?.input || 0,
        output: result.tokens_used?.output || 0
      };

      const actualProvider = result.provider || 'unknown';
      const actualModel = result.model || 'auto';

      const aiResponse: AIResponse = {
        content: result.content,
        provider: this.provider,
        model: `${actualProvider}/${actualModel}`,
        tokensUsed: {
          input: tokensUsed.input,
          output: tokensUsed.output,
          total: tokensUsed.input + tokensUsed.output
        },
        cost: result.cost || this.calculateCost(tokensUsed.input, tokensUsed.output),
        latency: Date.now() - startTime,
        cached: result.cached || false,
        requestId: result.request_id || this.generateRequestId(),
        timestamp: new Date()
      };

      return {
        ...aiResponse,
        object: result.object as T
      };

    } catch (error: any) {
      if (error instanceof AIProviderError) throw error;
      this.handleError(error);
    }
  }

  public async embed(text: string): Promise<number[]> {
    try {
      const response = await this.withTimeout(
        fetch(`${this.gatewayUrl}/api/v1/embed`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.gatewayApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text })
        })
      );

      if (!response.ok) {
        throw new AIProviderError(this.provider, 'server', `Gateway HTTP ${response.status}`, true);
      }

      const data = await response.json();
      return data.result?.embedding || [];

    } catch (error: any) {
      this.handleError(error);
    }
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const response = await this.withTimeout(
        fetch(`${this.gatewayUrl}/api/health`, {
          headers: {
            'Authorization': `Bearer ${this.gatewayApiKey}`
          }
        }),
        5000 // 5 second timeout for health check
      );
      
      if (!response.ok) return false;
      
      const data = await response.json();
      return data.status === 'healthy';
    } catch {
      return false;
    }
  }
}

// ─── Factory Function ────────────────────────────────────────────────

export function createAIGatewayProvider(apiKey: string, gatewayUrl: string, options?: {
  timeout?: number;
}): AIGatewayProvider {
  return new AIGatewayProvider({
    apiKey,
    baseURL: gatewayUrl,
    timeout: options?.timeout
  });
}