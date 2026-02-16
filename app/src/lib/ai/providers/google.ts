// ─── Google Gemini Provider Implementation ────────────────────────────
// Google Gemini models with large context windows and cost efficiency

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { BaseAIProvider } from './base';
import { AIProvider, AIRequest, AIResponse, AIProviderError } from '../types';

export class GoogleProvider extends BaseAIProvider {
  public readonly provider = AIProvider.GOOGLE;
  private client: GoogleGenerativeAI;

  constructor(config: {
    apiKey: string;
    baseURL?: string;
    timeout?: number;
  }) {
    super(config);
    
    this.client = new GoogleGenerativeAI(this.apiKey);
  }

  public async generateText(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      const model = this.client.getGenerativeModel({ 
        model: this.selectModel(request),
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          }
        ],
        generationConfig: {
          temperature: request.temperature || 0.7,
          maxOutputTokens: request.maxTokens || 2048,
        }
      });

      const prompt = this.buildPrompt(request);
      
      const result = await this.withTimeout(
        model.generateContent(prompt)
      );

      const response = await result.response;
      const content = response.text() || '';
      
      // Gemini doesn't provide detailed token usage in the free API
      // Estimate based on content length
      const tokensUsed = {
        input: this.estimateInputTokens(prompt),
        output: this.estimateInputTokens(content)
      };

      return this.createResponse(content, this.selectModel(request), tokensUsed, startTime);

    } catch (error: any) {
      if (error.message?.includes('quota')) {
        throw new AIProviderError(this.provider, 'rate-limit', 'Rate limit exceeded', true);
      }
      if (error.message?.includes('API key')) {
        throw new AIProviderError(this.provider, 'auth', 'Invalid API key', false);
      }
      if (error.message?.includes('safety')) {
        throw new AIProviderError(this.provider, 'safety', 'Content blocked by safety filters', false);
      }
      
      this.handleError(error);
    }
  }

  public async generateObject<T>(
    request: AIRequest & { schema: any }
  ): Promise<AIResponse & { object: T }> {
    const startTime = Date.now();
    
    try {
      const model = this.client.getGenerativeModel({ 
        model: this.selectModel(request),
        generationConfig: {
          temperature: request.temperature || 0.3, // Lower temperature for structured output
          maxOutputTokens: request.maxTokens || 2048,
        }
      });

      // Add JSON schema instruction to prompt
      const jsonInstruction = `Respond with valid JSON that matches this schema:\n${JSON.stringify(request.schema, null, 2)}\n\nReturn only the JSON object, no other text.`;
      const fullPrompt = this.buildPrompt(request) + `\n\n${jsonInstruction}`;
      
      const result = await this.withTimeout(
        model.generateContent(fullPrompt)
      );

      const response = await result.response;
      const content = response.text() || '{}';
      
      const tokensUsed = {
        input: this.estimateInputTokens(fullPrompt),
        output: this.estimateInputTokens(content)
      };

      let parsedObject: T;
      try {
        // Gemini might include markdown formatting, so try to extract JSON
        let jsonString = content.trim();
        if (jsonString.startsWith('```json')) {
          const match = jsonString.match(/```json\n([\s\S]*)\n```/);
          jsonString = match ? match[1] : jsonString;
        } else if (jsonString.startsWith('```')) {
          const match = jsonString.match(/```\n([\s\S]*)\n```/);
          jsonString = match ? match[1] : jsonString;
        }
        
        parsedObject = JSON.parse(jsonString);
      } catch (parseError) {
        throw new AIProviderError(
          this.provider,
          'parse-error',
          `Failed to parse JSON response: ${content}`,
          false
        );
      }

      const aiResponse = this.createResponse(content, this.selectModel(request), tokensUsed, startTime);
      return { ...aiResponse, object: parsedObject };

    } catch (error: any) {
      if (error instanceof AIProviderError) throw error;
      this.handleError(error);
    }
  }

  public async embed(text: string): Promise<number[]> {
    try {
      const model = this.client.getGenerativeModel({ model: 'embedding-001' });
      
      const result = await this.withTimeout(
        model.embedContent(text)
      );

      return result.embedding?.values || [];

    } catch (error: any) {
      this.handleError(error);
    }
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        generationConfig: {
          maxOutputTokens: 5
        }
      });
      
      const result = await this.withTimeout(
        model.generateContent('Hello'),
        5000 // 5 second timeout for health check
      );
      
      const response = await result.response;
      return response.text().length > 0;
    } catch {
      return false;
    }
  }

  private selectModel(request: AIRequest): string {
    // Select model based on task complexity and context requirements
    if (request.maxTokens && request.maxTokens > 100000) {
      return 'gemini-2.5-pro'; // Large context needs
    }
    
    switch (request.taskType) {
      case 'document_analysis':
        return 'gemini-2.5-pro'; // Best for long document analysis
      
      case 'simple_text_generation':
      case 'compliance_check':
      case 'grant_matching':
      case 'budget_analysis':
        return 'gemini-2.5-flash'; // Fast and cost-effective
      
      case 'proposal_generation':
      case 'risk_assessment':
        return 'gemini-2.5-pro'; // Better quality for complex tasks
      
      default:
        return 'gemini-2.5-flash'; // Default to cost-effective model
    }
  }

  private buildPrompt(request: AIRequest): string {
    let prompt = '';
    
    if (request.systemPrompt) {
      prompt += `System: ${request.systemPrompt}\n\n`;
    }
    
    prompt += `User: ${request.prompt}`;
    
    return prompt;
  }
}

// ─── Factory Function ────────────────────────────────────────────────

export function createGoogleProvider(apiKey: string, options?: {
  baseURL?: string;
  timeout?: number;
}): GoogleProvider {
  return new GoogleProvider({
    apiKey,
    baseURL: options?.baseURL,
    timeout: options?.timeout
  });
}