// ─── OpenAI Provider Implementation ──────────────────────────────────
// OpenAI GPT models with function calling and embeddings

import OpenAI from 'openai';
import { BaseAIProvider } from './base';
import { AIProvider, AIRequest, AIResponse, AIProviderError } from '../types';
import { z } from 'zod';

export class OpenAIProvider extends BaseAIProvider {
  public readonly provider = AIProvider.OPENAI;
  private client: OpenAI;

  constructor(config: {
    apiKey: string;
    baseURL?: string;
    timeout?: number;
  }) {
    super(config);
    
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL || 'https://api.openai.com/v1',
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
          messages: messages as any,
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature || 0.7,
          stream: false
        })
      );

      const completionResponse = response as any;
      const content = completionResponse.choices[0]?.message?.content || '';
      const tokensUsed = {
        input: completionResponse.usage?.prompt_tokens || 0,
        output: completionResponse.usage?.completion_tokens || 0
      };

      return this.createResponse(content, model, tokensUsed, startTime);

    } catch (error: any) {
      if (error.status === 429) {
        throw new AIProviderError(this.provider, 'rate-limit', 'Rate limit exceeded', true);
      }
      if (error.status === 401) {
        throw new AIProviderError(this.provider, 'auth', 'Invalid API key', false);
      }
      if (error.status >= 500) {
        throw new AIProviderError(this.provider, 'server', 'OpenAI server error', true);
      }
      
      this.handleError(error);
    }
  }

  public async generateObject<T>(
    request: AIRequest & { schema: any }
  ): Promise<AIResponse & { object: T }> {
    const startTime = Date.now();
    
    try {
      const model = this.selectModel(request);
      const messages = this.buildMessages(request);

      // Add JSON schema instruction to system prompt
      const jsonInstruction = `You must respond with valid JSON that matches this schema: ${JSON.stringify(request.schema)}`;
      const systemMessage = messages.find(m => m.role === 'system');
      if (systemMessage) {
        systemMessage.content += `\n\n${jsonInstruction}`;
      } else {
        messages.unshift({ role: 'system', content: jsonInstruction });
      }

      const response = await this.withTimeout(
        this.client.chat.completions.create({
          model,
          messages: messages as any,
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature || 0.3, // Lower temperature for structured output
          response_format: { type: 'json_object' },
          stream: false
        })
      );

      const completionResponse = response as any;
      const content = completionResponse.choices[0]?.message?.content || '{}';
      const tokensUsed = {
        input: completionResponse.usage?.prompt_tokens || 0,
        output: completionResponse.usage?.completion_tokens || 0
      };

      let parsedObject: T;
      try {
        parsedObject = JSON.parse(content);
      } catch (parseError) {
        throw new AIProviderError(
          this.provider,
          'parse-error',
          `Failed to parse JSON response: ${content}`,
          false
        );
      }

      const aiResponse = this.createResponse(content, model, tokensUsed, startTime);
      return { ...aiResponse, object: parsedObject };

    } catch (error: any) {
      if (error instanceof AIProviderError) throw error;
      this.handleError(error);
    }
  }

  public async embed(text: string): Promise<number[]> {
    try {
      const response = await this.withTimeout(
        this.client.embeddings.create({
          model: 'text-embedding-3-small',
          input: text
        })
      );

      return response.data[0]?.embedding || [];

    } catch (error: any) {
      this.handleError(error);
    }
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const response = await this.withTimeout(
        this.client.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5
        }),
        5000 // 5 second timeout for health check
      );
      
      return response.choices.length > 0;
    } catch {
      return false;
    }
  }

  private selectModel(request: AIRequest): string {
    // Select model based on task complexity and requirements
    if (request.maxTokens && request.maxTokens > 16000) {
      return 'gpt-4-turbo'; // Large context needs
    }
    
    switch (request.taskType) {
      case 'proposal_generation':
      case 'risk_assessment':
      case 'legal_analysis':
        return 'gpt-4o'; // High complexity tasks
      
      case 'simple_text_generation':
      case 'compliance_check':
      case 'grant_matching':
        return 'gpt-4o-mini'; // Cost-effective for simple tasks
      
      case 'document_analysis':
        return 'gpt-4o'; // Good for analysis
      
      default:
        return 'gpt-4o-mini'; // Default to cost-effective model
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

export function createOpenAIProvider(apiKey: string, options?: {
  baseURL?: string;
  timeout?: number;
}): OpenAIProvider {
  return new OpenAIProvider({
    apiKey,
    baseURL: options?.baseURL,
    timeout: options?.timeout
  });
}