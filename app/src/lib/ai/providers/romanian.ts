// ─── Romanian OpenLLM-Ro Provider Implementation ─────────────────────
// OpenLLM-Ro models for native Romanian language processing

import { BaseAIProvider } from './base';
import { AIProvider, AIRequest, AIResponse, AIProviderError } from '../types';

export class RomanianProvider extends BaseAIProvider {
  public readonly provider = AIProvider.OPENLLM_RO;
  private huggingFaceToken: string;
  private modelEndpoint: string;

  constructor(config: {
    apiKey: string; // HuggingFace token
    baseURL?: string; // Model endpoint
    timeout?: number;
  }) {
    super(config);
    
    this.huggingFaceToken = this.apiKey;
    this.modelEndpoint = this.baseURL || 
      'https://api-inference.huggingface.co/models/openllm-ro/rollama3-8b-instruct';
  }

  public async generateText(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      const prompt = this.buildRomanianPrompt(request);
      
      const response = await this.withTimeout(
        fetch(this.modelEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.huggingFaceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              max_new_tokens: request.maxTokens || 2048,
              temperature: request.temperature || 0.7,
              do_sample: true,
              return_full_text: false
            }
          })
        })
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new AIProviderError(this.provider, 'rate-limit', 'Rate limit exceeded', true);
        }
        if (response.status === 401) {
          throw new AIProviderError(this.provider, 'auth', 'Invalid HuggingFace token', false);
        }
        throw new AIProviderError(this.provider, 'server', `HTTP ${response.status}`, true);
      }

      const data = await response.json();
      
      let content = '';
      if (Array.isArray(data) && data[0]?.generated_text) {
        content = data[0].generated_text;
      } else if (data.generated_text) {
        content = data.generated_text;
      } else {
        throw new AIProviderError(
          this.provider, 
          'parse-error', 
          'Unexpected response format', 
          false
        );
      }

      // Estimate token usage (HuggingFace doesn't provide exact counts)
      const tokensUsed = {
        input: this.estimateInputTokens(prompt),
        output: this.estimateInputTokens(content)
      };

      return this.createResponse(content, 'rollama3-8b-instruct', tokensUsed, startTime);

    } catch (error: unknown) {
      if (error instanceof AIProviderError) throw error;
      this.handleError(error);
    }
  }

  public async generateObject<T>(
    request: AIRequest & { schema: unknown }
  ): Promise<AIResponse & { object: T }> {
    try {
      // Romanian models might not be as good at structured output
      // Add stronger JSON formatting instructions
      const jsonInstruction = `
Răspundeți DOAR cu JSON valid care respectă această schemă:
${JSON.stringify(request.schema, null, 2)}

IMPORTANT: Răspunsul trebuie să fie doar obiectul JSON, fără text suplimentar.
`;
      
      const modifiedRequest = {
        ...request,
        prompt: request.prompt + '\n\n' + jsonInstruction
      };
      
      const textResponse = await this.generateText(modifiedRequest);
      
      let parsedObject: T;
      try {
        // Try to extract JSON from the response
        const content = textResponse.content.trim();
        let jsonString = content;
        
        // Look for JSON object in the response
        const jsonMatch = content.match(/\{[^}]*\}/);
        if (jsonMatch) {
          jsonString = jsonMatch[0];
        }
        
        parsedObject = JSON.parse(jsonString);
      } catch {
        throw new AIProviderError(
          this.provider,
          'parse-error',
          `Failed to parse JSON response: ${textResponse.content}`,
          false
        );
      }

      return { ...textResponse, object: parsedObject };

    } catch (error: unknown) {
      if (error instanceof AIProviderError) throw error;
      this.handleError(error);
    }
  }

  public async embed(text: string): Promise<number[]> {
    void text;
    // OpenLLM-Ro doesn't provide embeddings
    throw new AIProviderError(
      this.provider,
      'not-supported',
      'OpenLLM-Ro does not support embeddings',
      false
    );
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const response = await this.withTimeout(
        fetch(this.modelEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.huggingFaceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: 'Salut',
            parameters: {
              max_new_tokens: 5,
              temperature: 0.1
            }
          })
        }),
        5000 // 5 second timeout for health check
      );
      
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildRomanianPrompt(request: AIRequest): string {
    let prompt = '';
    
    if (request.systemPrompt) {
      // Translate system prompt context to Romanian if needed
      prompt += `Instrucțiuni sistem: ${request.systemPrompt}\n\n`;
    }
    
    // Add Romanian context instructions
    prompt += `Te rog să răspunzi în română, ținând cont de contextul cultural și legislativ românesc. `;
    
    // Add EU funding context if relevant
    if (request.taskType.includes('proposal') || request.taskType.includes('funding')) {
      prompt += `Consideră specificul programelor de finanțare europeană pentru România. `;
    }
    
    prompt += `\n\nÎntrebarea: ${request.prompt}`;
    
    return prompt;
  }
}

// ─── Factory Function ────────────────────────────────────────────────

export function createRomanianProvider(huggingFaceToken: string, options?: {
  modelEndpoint?: string;
  timeout?: number;
}): RomanianProvider {
  return new RomanianProvider({
    apiKey: huggingFaceToken,
    baseURL: options?.modelEndpoint,
    timeout: options?.timeout
  });
}
