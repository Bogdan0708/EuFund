// ─── Claude Provider Implementation ──────────────────────────────────
// Anthropic Claude models with advanced reasoning capabilities

import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider } from './base';
import { AIProvider, AIRequest, AIResponse, AIProviderError } from '../types';

export class ClaudeProvider extends BaseAIProvider {
  public readonly provider = AIProvider.ANTHROPIC;
  private client: Anthropic;

  constructor(config: {
    apiKey: string;
    baseURL?: string;
    timeout?: number;
  }) {
    super(config);
    
    this.client = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      timeout: this.timeout
    });
  }

  public async generateText(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      const model = this.selectModel(request);
      
      const response = await this.withTimeout(
        this.client.messages.create({
          model,
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature || 0.7,
          system: request.systemPrompt,
          messages: [
            {
              role: 'user',
              content: request.prompt
            }
          ]
        })
      );

      const content = response.content[0]?.type === 'text' 
        ? response.content[0].text 
        : '';
        
      const tokensUsed = {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0
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
        throw new AIProviderError(this.provider, 'server', 'Claude server error', true);
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
      
      // Claude doesn't have native JSON mode, so we add JSON instructions
      const jsonInstruction = `Respond with valid JSON that matches this schema:\n${JSON.stringify(request.schema, null, 2)}\n\nReturn only the JSON object, no other text.`;
      const fullPrompt = `${request.prompt}\n\n${jsonInstruction}`;
      
      const response = await this.withTimeout(
        this.client.messages.create({
          model,
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature || 0.3, // Lower temperature for structured output
          system: request.systemPrompt,
          messages: [
            {
              role: 'user',
              content: fullPrompt
            }
          ]
        })
      );

      const content = response.content[0]?.type === 'text' 
        ? response.content[0].text 
        : '{}';
        
      const tokensUsed = {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0
      };

      let parsedObject: T;
      try {
        // Claude might include extra text, so try to extract JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const jsonString = jsonMatch ? jsonMatch[0] : content;
        parsedObject = JSON.parse(jsonString);
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
    // Claude doesn't provide embeddings, so we throw an error
    throw new AIProviderError(
      this.provider,
      'not-supported',
      'Claude does not support embeddings',
      false
    );
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const response = await this.withTimeout(
        this.client.messages.create({
          model: 'claude-3-haiku-20240307', // Use fastest model for health check
          max_tokens: 10,
          messages: [
            {
              role: 'user',
              content: 'Hello'
            }
          ]
        }),
        5000 // 5 second timeout for health check
      );
      
      return response.content.length > 0;
    } catch {
      return false;
    }
  }

  private selectModel(request: AIRequest): string {
    // Select model based on task complexity and requirements
    if (request.taskType === 'romanian_localization') {
      return 'claude-3-5-sonnet-20241022'; // Best for language tasks
    }
    
    switch (request.taskType) {
      case 'proposal_generation':
      case 'risk_assessment':
      case 'legal_analysis':
      case 'creative_writing':
        return 'claude-3-opus-20240229'; // Highest quality for complex tasks
      
      case 'document_analysis':
      case 'compliance_check':
      case 'partner_matching':
        return 'claude-3-5-sonnet-20241022'; // Good balance of quality and speed
      
      case 'simple_text_generation':
      case 'grant_matching':
        return 'claude-3-haiku-20240307'; // Fast and cost-effective
      
      default:
        return 'claude-3-5-sonnet-20241022'; // Default to balanced model
    }
  }
}

// ─── Factory Function ────────────────────────────────────────────────

export function createClaudeProvider(apiKey: string, options?: {
  baseURL?: string;
  timeout?: number;
}): ClaudeProvider {
  return new ClaudeProvider({
    apiKey,
    baseURL: options?.baseURL,
    timeout: options?.timeout
  });
}