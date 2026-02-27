// ─── Perplexity Provider Implementation ──────────────────────────────
// Perplexity models for real-time web research and grant matching

import OpenAI from 'openai';
import { BaseAIProvider } from './base';
import { AIProvider, AIRequest, AIResponse, AIProviderError } from '../types';

export class PerplexityProvider extends BaseAIProvider {
  public readonly provider = AIProvider.PERPLEXITY;
  private client: OpenAI;

  constructor(config: {
    apiKey: string;
    baseURL?: string;
    timeout?: number;
  }) {
    super(config);
    
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL || 'https://api.perplexity.ai',
      timeout: this.timeout
    });
  }

  public async generateText(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      const model = this.selectModel(request);
      const messages = this.buildMessages(request);
      
      const response = await this.withTimeout(
        this.client.chat.completions.create({
          model,
          messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature || 0.7,
          stream: false
        })
      );

      const content = response.choices[0]?.message?.content || '';
      const tokensUsed = {
        input: response.usage?.prompt_tokens || 0,
        output: response.usage?.completion_tokens || 0
      };

      return this.createResponse(content, model, tokensUsed, startTime);

    } catch (error: unknown) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status?: number }).status
        : undefined;
      
      if (status === 429) {
        throw new AIProviderError(this.provider, 'rate-limit', 'Perplexity rate limit exceeded', true);
      }
      if (status === 401) {
        throw new AIProviderError(this.provider, 'auth', 'Invalid Perplexity API key', false);
      }
      if ((status ?? 0) >= 500) {
        throw new AIProviderError(this.provider, 'server', 'Perplexity server error', true);
      }
      
      this.handleError(error);
    }
  }

  public async generateObject<T>(
    request: AIRequest & { schema: unknown }
  ): Promise<AIResponse & { object: T }> {
    // Perplexity models don't support response_format: { type: 'json_object' } yet
    // We'll use the prompt engineering approach
    const startTime = Date.now();
    
    try {
      const model = this.selectModel(request);
      const messages = this.buildMessages(request);

      const jsonInstruction = `You must respond ONLY with valid JSON that matches this schema: ${JSON.stringify(request.schema)}. Do not include any other text or explanation.`;
      const systemMessage = messages.find(m => m.role === 'system');
      if (systemMessage) {
        systemMessage.content += `

${jsonInstruction}`;
      } else {
        messages.unshift({ role: 'system', content: jsonInstruction });
      }

      const response = await this.withTimeout(
        this.client.chat.completions.create({
          model,
          messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          max_tokens: request.maxTokens || 2048,
          temperature: 0.1, // Very low for deterministic JSON
          stream: false
        })
      );

      const content = response.choices[0]?.message?.content || '{}';
      
      // Attempt to extract JSON if there's markdown fluff
      let jsonString = content.trim();
      if (jsonString.includes('```json')) {
        jsonString = jsonString.split('```json')[1].split('```')[0].trim();
      } else if (jsonString.includes('```')) {
        jsonString = jsonString.split('```')[1].split('```')[0].trim();
      }

      const tokensUsed = {
        input: response.usage?.prompt_tokens || 0,
        output: response.usage?.completion_tokens || 0
      };

      let parsedObject: T;
      try {
        parsedObject = JSON.parse(jsonString);
      } catch {
        throw new AIProviderError(
          this.provider,
          'parse-error',
          `Failed to parse JSON response from Perplexity: ${content}`,
          false
        );
      }

      const aiResponse = this.createResponse(content, model, tokensUsed, startTime);
      return { ...aiResponse, object: parsedObject };

    } catch (error: unknown) {
      if (error instanceof AIProviderError) throw error;
      this.handleError(error);
    }
  }

  public async embed(text: string): Promise<number[]> {
    void text;
    throw new AIProviderError(
      this.provider,
      'not-supported',
      'Perplexity does not support embeddings',
      false
    );
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const response = await this.withTimeout(
        this.client.chat.completions.create({
          model: 'llama-3.1-sonar-small-128k-online',
          messages: [{ role: 'user', content: 'health check' }],
          max_tokens: 5
        }),
        5000
      );
      
      return response.choices.length > 0;
    } catch {
      return false;
    }
  }

  private selectModel(request: AIRequest): string {
    // Priority: use provided model if possible, otherwise default to sonar-large for web search
    switch (request.taskType) {
      case 'web_research':
      case 'grant_matching':
      case 'partner_matching':
        return 'llama-3.1-sonar-large-128k-online';
      default:
        return 'llama-3.1-sonar-small-128k-chat';
    }
  }

  private buildMessages(request: AIRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    
    if (request.systemPrompt) {
      messages.push({
        role: 'system',
        content: request.systemPrompt
      });
    }
    
    messages.push({
      role: 'user',
      content: request.prompt
    });
    
    return messages;
  }
}

// ─── Factory Function ────────────────────────────────────────────────

export function createPerplexityProvider(apiKey: string, options?: {
  baseURL?: string;
  timeout?: number;
}): PerplexityProvider {
  return new PerplexityProvider({
    apiKey,
    baseURL: options?.baseURL,
    timeout: options?.timeout
  });
}
