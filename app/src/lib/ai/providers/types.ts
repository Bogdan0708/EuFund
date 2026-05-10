export interface GenerateRequest {
  system?: string
  messages: RouterMessage[]
  provider: ProviderName
  model: string
  maxTokens?: number
  temperature?: number
  tools?: ToolSchema[]
  cache?: CacheOptions
}

export interface GenerateResult {
  content: string
  tokensUsed: { input: number; output: number }
  model: string
  provider: ProviderName
  toolCalls?: ToolCallResult[]
  cacheUsage?: CacheUsage
}

// Issue #83 item 6 (P3): discriminated union enforces at compile time that
// tool_call_id only appears on role='tool' messages, tool_calls only on
// role='assistant', and tool_call_id is REQUIRED (not optional) when present.
// This catches the class of bug PR #80 fixed at runtime — providers can no
// longer be handed a tool message without a tool_call_id.
export type RouterMessage =
  | { role: 'user' | 'system'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: RouterToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }

export interface RouterToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
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
  generate(req: GenerateRequest & { provider: ProviderName }, signal?: AbortSignal): Promise<GenerateResult>
  embed?(text: string, signal?: AbortSignal): Promise<number[]>
}

export interface ModelConfig {
  provider: ProviderName
  model: string
  timeout: number
  fallback?: { provider: ProviderName; model: string }
}

export interface CacheOptions {
  enabled: boolean
  key?: string
  breakpoints?: Array<'system' | 'tools'>
  ttlSeconds?: number
}

export type CacheDisabledReason = 'global_kill_switch' | 'request_disabled' | 'none'
export type CacheHit = 'read' | 'miss' | 'disabled' | 'unsupported'

export interface CacheUsage {
  requested: boolean
  enabled: boolean
  disabledReason: CacheDisabledReason
  identityKey: string
  supported: boolean
  reads: number
  writes: number
  hit: CacheHit
  effectiveTtlSeconds?: number
}

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'claude-opus-4-6': { provider: 'anthropic', model: 'claude-opus-4-6', timeout: 180_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'claude-sonnet-4-6': { provider: 'anthropic', model: 'claude-sonnet-4-6', timeout: 90_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'claude-haiku-4-5': { provider: 'anthropic', model: 'claude-haiku-4-5', timeout: 30_000, fallback: { provider: 'openai', model: 'gpt-5.4-mini' } },
  'gpt-5.4': { provider: 'openai', model: 'gpt-5.4', timeout: 60_000, fallback: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  'gpt-5.4-mini': { provider: 'openai', model: 'gpt-5.4-mini', timeout: 45_000, fallback: { provider: 'anthropic', model: 'claude-haiku-4-5' } },
  'gpt-5.4-nano': { provider: 'openai', model: 'gpt-5.4-nano', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-3-flash' } },
  'gemini-3.1-pro': { provider: 'google', model: 'gemini-3.1-pro', timeout: 90_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'gemini-3-flash': { provider: 'google', model: 'gemini-3-flash', timeout: 30_000, fallback: { provider: 'openai', model: 'gpt-5.4-mini' } },
  'nano-banana': { provider: 'google', model: 'nano-banana', timeout: 60_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'sonar': { provider: 'perplexity', model: 'sonar', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-3-flash' } },
  'sonar-pro': { provider: 'perplexity', model: 'sonar-pro', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-3-flash' } },
}

export { SECTION_MODEL_ROUTING, type RoutingTier } from '../model-routing'
