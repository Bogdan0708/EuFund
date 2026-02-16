// ─── AI Providers Index ──────────────────────────────────────────────
// Central exports for all AI provider implementations

export { BaseAIProvider, ProviderRegistry } from './base';
export { OpenAIProvider, createOpenAIProvider } from './openai';
export { ClaudeProvider, createClaudeProvider } from './claude';
export { GoogleProvider, createGoogleProvider } from './google';
export { RomanianProvider, createRomanianProvider } from './romanian';
export { AIGatewayProvider, createAIGatewayProvider } from './gateway';

// Provider factory function for easy initialization
import { AIProvider, ProviderConfig } from '../types';
import { BaseAIProvider } from './base';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import { GoogleProvider } from './google';
import { RomanianProvider } from './romanian';
import { AIGatewayProvider } from './gateway';

export function createProvider(config: ProviderConfig): BaseAIProvider {
  const { provider, apiKey, baseURL, timeout } = config;
  
  const providerConfig = {
    apiKey,
    baseURL,
    timeout
  };

  switch (provider) {
    case AIProvider.OPENAI:
      return new OpenAIProvider(providerConfig);
    
    case AIProvider.ANTHROPIC:
      return new ClaudeProvider(providerConfig);
    
    case AIProvider.GOOGLE:
      return new GoogleProvider(providerConfig);
    
    case AIProvider.OPENLLM_RO:
      return new RomanianProvider(providerConfig);
    
    case AIProvider.AI_GATEWAY:
      if (!baseURL) {
        throw new Error('AI Gateway requires baseURL');
      }
      return new AIGatewayProvider({
        apiKey,
        baseURL: baseURL!,
        timeout
      });
    
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}