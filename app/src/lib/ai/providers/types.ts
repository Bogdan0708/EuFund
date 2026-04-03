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
  'claude-opus-4-6': { provider: 'anthropic', model: 'claude-opus-4-6', timeout: 180_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'claude-sonnet-4-6': { provider: 'anthropic', model: 'claude-sonnet-4-6', timeout: 90_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'gpt-5.4': { provider: 'openai', model: 'gpt-5.4', timeout: 60_000, fallback: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  'gemini-2.5-flash': { provider: 'google', model: 'gemini-2.5-flash', timeout: 45_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'sonar': { provider: 'perplexity', model: 'sonar', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-2.5-flash' } },
  'sonar-pro': { provider: 'perplexity', model: 'sonar-pro', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-2.5-flash' } },
}

export const SECTION_MODEL_ROUTING = {
  critical: 'claude-opus-4-6',
  standard: 'claude-sonnet-4-6',
  budget: 'gpt-5.4',
} as const
