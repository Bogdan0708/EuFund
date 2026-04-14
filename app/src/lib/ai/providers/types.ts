export interface GenerateRequest {
  system?: string
  messages: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string; tool_call_id?: string }[]
  provider: ProviderName
  model: string
  maxTokens?: number
  temperature?: number
  tools?: ToolSchema[]
}

export interface GenerateResult {
  content: string
  tokensUsed: { input: number; output: number }
  model: string
  provider: ProviderName
  toolCalls?: ToolCallResult[]
}

export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCallResult {
  id: string
  name: string
  arguments: string
}

export type ProviderName = 'openai' | 'anthropic' | 'google' | 'perplexity'

export interface ProviderClient {
  generate(req: GenerateRequest): Promise<GenerateResult>
  embed?(text: string): Promise<number[]>
}

export interface ModelConfig {
  provider: ProviderName
  model: string
  timeout: number
  fallback?: { provider: ProviderName; model: string }
}

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // Anthropic
  'claude-opus-4-6': { provider: 'anthropic', model: 'claude-opus-4-6', timeout: 180_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'claude-sonnet-4-6': { provider: 'anthropic', model: 'claude-sonnet-4-6', timeout: 90_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'claude-haiku-4-5': { provider: 'anthropic', model: 'claude-haiku-4-5', timeout: 30_000, fallback: { provider: 'openai', model: 'gpt-5.4-mini' } },
  // OpenAI
  'gpt-5.4': { provider: 'openai', model: 'gpt-5.4', timeout: 60_000, fallback: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  'gpt-5.4-mini': { provider: 'openai', model: 'gpt-5.4-mini', timeout: 45_000, fallback: { provider: 'anthropic', model: 'claude-haiku-4-5' } },
  'gpt-5.4-nano': { provider: 'openai', model: 'gpt-5.4-nano', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-3-flash' } },
  // Google
  'gemini-3.1-pro': { provider: 'google', model: 'gemini-3.1-pro', timeout: 90_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'gemini-3-flash': { provider: 'google', model: 'gemini-3-flash', timeout: 30_000, fallback: { provider: 'openai', model: 'gpt-5.4-mini' } },
  'nano-banana': { provider: 'google', model: 'nano-banana', timeout: 60_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  // Perplexity
  'sonar': { provider: 'perplexity', model: 'sonar', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-3-flash' } },
  'sonar-pro': { provider: 'perplexity', model: 'sonar-pro', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-3-flash' } },
}

// Re-exported from the single source of truth in model-routing.ts
export { SECTION_MODEL_ROUTING, type RoutingTier } from '../model-routing'
