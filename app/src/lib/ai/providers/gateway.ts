// ─── AI Gateway Provider Implementation ──────────────────────────────
// Gateway to the existing multi-provider AI service

import { BaseAIProvider } from './base';
import { AIProvider, AIRequest, AIResponse, AIProviderError } from '../types';
import { AI_CONFIG } from '../config';

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
    this.gatewayUrl = this.baseURL || 'https://ai-gateway-382299704849.europe-central2.run.app';
  }

  public async generateText(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      const model = this.selectModel(request);
      const messages = this.buildMessages(request);
      
      const response = await this.withTimeout(
        fetch(`${this.gatewayUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.gatewayApiKey}`,
            'Content-Type': 'application/json',
            'X-User-ID': request.userId,
            'x-tenant-id': AI_CONFIG.gateway.tenantId,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: request.maxTokens || 2048,
            temperature: request.temperature || 0.7,
            stream: false,
          })
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

      const data = await response.json() as {
        id?: string;
        model?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const tokensUsed = {
        input: data.usage?.prompt_tokens || 0,
        output: data.usage?.completion_tokens || 0
      };

      return {
        content: data.choices?.[0]?.message?.content || '',
        provider: this.provider,
        model: data.model || model,
        tokensUsed: {
          input: tokensUsed.input,
          output: tokensUsed.output,
          total: tokensUsed.input + tokensUsed.output
        },
        cost: this.calculateCost(tokensUsed.input, tokensUsed.output),
        latency: Date.now() - startTime,
        cached: false,
        requestId: data.id || this.generateRequestId(),
        timestamp: new Date()
      };

    } catch (error: unknown) {
      if (error instanceof AIProviderError) throw error;
      this.handleError(error);
    }
  }

  public async generateObject<T>(
    request: AIRequest & { schema: unknown }
  ): Promise<AIResponse & { object: T }> {
    const startTime = Date.now();

    try {
      const model = this.selectModel(request);
      const messages = this.buildMessages(request);
      const schemaInstruction = `You must respond with valid JSON that matches this schema: ${JSON.stringify(request.schema)}`;

      if (messages[0]?.role === 'system') {
        messages[0].content = `${messages[0].content}\n\n${schemaInstruction}`;
      } else {
        messages.unshift({ role: 'system', content: schemaInstruction });
      }

      const response = await this.withTimeout(
        fetch(`${this.gatewayUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.gatewayApiKey}`,
            'Content-Type': 'application/json',
            'X-User-ID': request.userId,
            'x-tenant-id': AI_CONFIG.gateway.tenantId,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: request.maxTokens || 2048,
            temperature: request.temperature || 0.3,
            response_format: { type: 'json_object' },
            stream: false,
          })
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

      const data = await response.json() as {
        id?: string;
        model?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content || '{}';
      const tokensUsed = {
        input: data.usage?.prompt_tokens || 0,
        output: data.usage?.completion_tokens || 0
      };

      const aiResponse: AIResponse = {
        content,
        provider: this.provider,
        model: data.model || model,
        tokensUsed: {
          input: tokensUsed.input,
          output: tokensUsed.output,
          total: tokensUsed.input + tokensUsed.output
        },
        cost: this.calculateCost(tokensUsed.input, tokensUsed.output),
        latency: Date.now() - startTime,
        cached: false,
        requestId: data.id || this.generateRequestId(),
        timestamp: new Date()
      };

      return {
        ...aiResponse,
        object: JSON.parse(content) as T
      };

    } catch (error: unknown) {
      if (error instanceof AIProviderError) throw error;
      this.handleError(error);
    }
  }

  public async embed(text: string): Promise<number[]> {
    try {
      const response = await this.withTimeout(
        fetch(`${this.gatewayUrl}/v1/embeddings`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.gatewayApiKey}`,
            'Content-Type': 'application/json',
            'x-tenant-id': AI_CONFIG.gateway.tenantId,
          },
          body: JSON.stringify({
            model: AI_CONFIG.embedding.model,
            input: text,
          })
        })
      );

      if (!response.ok) {
        throw new AIProviderError(this.provider, 'server', `Gateway HTTP ${response.status}`, true);
      }

      const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
      return data.data?.[0]?.embedding || [];

    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const response = await this.withTimeout(
        fetch(`${this.gatewayUrl}/health`, {
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

  private selectModel(request: AIRequest): string {
    switch (request.taskType) {
      case 'proposal_generation':
      case 'risk_assessment':
      case 'legal_analysis':
        return AI_CONFIG.generation.model;
      default:
        return AI_CONFIG.analysis.model;
    }
  }

  private buildMessages(request: AIRequest): Array<{ role: 'system' | 'user'; content: string }> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    messages.push({ role: 'user', content: request.prompt });
    return messages;
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
