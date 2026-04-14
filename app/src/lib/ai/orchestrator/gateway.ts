import OpenAI from 'openai'
import type { GatewayClient } from './types'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'gateway' })

// ─── Provider clients (lazy-initialized singletons) ─────────────

const clients: Record<string, OpenAI> = {}

function getClient(provider: string): OpenAI {
  if (clients[provider]) return clients[provider]

  switch (provider) {
    case 'openai':
      clients[provider] = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      break
    case 'claude':
    case 'anthropic':
      clients[provider] = new OpenAI({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: 'https://api.anthropic.com/v1/',
      })
      break
    case 'gemini':
    case 'google':
      clients[provider] = new OpenAI({
        apiKey: process.env.GOOGLE_AI_API_KEY,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      })
      break
    case 'perplexity':
      clients[provider] = new OpenAI({
        apiKey: process.env.PERPLEXITY_API_KEY,
        baseURL: 'https://api.perplexity.ai/',
      })
      break
    default:
      log.warn({ provider }, 'Unknown provider, falling back to OpenAI')
      clients[provider] = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return clients[provider]
}

// ─── Timeouts per model ─────────────────────────────────────────

const MODEL_TIMEOUTS: Record<string, number> = {
  'claude-opus-4-6': 300_000,
  'claude-sonnet-4-6': 180_000,
  'claude-haiku-4-5': 60_000,
  'gpt-5.4': 180_000,
  'gpt-5.4-mini': 90_000,
  'gpt-5.4-nano': 60_000,
  'gemini-3.1-pro': 180_000,
  'gemini-3-flash': 60_000,
  'nano-banana': 120_000,
  'sonar': 60_000,
  'sonar-pro': 60_000,
  'text-embedding-3-small': 15_000,
}

export function getTimeout(model: string): number {
  return MODEL_TIMEOUTS[model] ?? 60_000
}

// ─── Fallback providers ─────────────────────────────────────────

const FALLBACK_PROVIDER: Record<string, { provider: string; model: string }> = {
  perplexity: { provider: 'gemini', model: 'gemini-3-flash' },
  anthropic:  { provider: 'openai', model: 'gpt-5.4' },
  claude:     { provider: 'openai', model: 'gpt-5.4' },
  openai:     { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  google:     { provider: 'openai', model: 'gpt-5.4' },
  gemini:     { provider: 'openai', model: 'gpt-5.4' },
}

// ─── Retry classification ───────────────────────────────────────

function shouldRetry(error: unknown): boolean {
  if (error instanceof Error && 'status' in error) {
    const status = (error as { status: number }).status
    if ([429, 500, 502, 503].includes(status)) return true
    return false
  }
  if (error instanceof Error && error.name === 'AbortError') return false
  return true
}

function getRetryDelay(error: unknown): number {
  if (error instanceof Error && 'status' in error) {
    return (error as { status: number }).status === 429 ? 2000 : 1000
  }
  return 1000
}

// ─── Core call with timeout ─────────────────────────────────────

async function singleCall(
  provider: string,
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  maxTokens: number,
  temperature: number,
): Promise<{ content: string; tokensUsed: number }> {
  const client = getClient(provider)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getTimeout(model))

  try {
    const response = await client.chat.completions.create(
      { model, messages, max_completion_tokens: maxTokens, temperature },
      { signal: controller.signal },
    )
    const content = response.choices?.[0]?.message?.content ?? ''
    const tokensUsed = response.usage?.total_tokens ?? 0
    if (!content) throw new Error('Empty response from provider')
    return { content, tokensUsed }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Retry + fallback ───────────────────────────────────────────

async function callWithRetry(
  provider: string,
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  maxTokens: number,
  temperature: number,
): Promise<{ content: string; tokensUsed: number }> {
  try {
    return await singleCall(provider, model, messages, maxTokens, temperature)
  } catch (err) {
    log.warn({ provider, model, error: err instanceof Error ? err.message : String(err) }, 'Primary call failed')

    if (shouldRetry(err)) {
      const delay = getRetryDelay(err)
      await new Promise(r => setTimeout(r, delay))
      try {
        return await singleCall(provider, model, messages, maxTokens, temperature)
      } catch (retryErr) {
        log.warn({ provider, model, error: retryErr instanceof Error ? retryErr.message : String(retryErr) }, 'Retry failed')
      }
    }

    const fallback = FALLBACK_PROVIDER[provider]
    if (fallback) {
      log.info({ from: provider, to: fallback.provider, model: fallback.model }, 'Falling back')
      return await singleCall(fallback.provider, fallback.model, messages, maxTokens, temperature)
    }

    throw new Error(`All attempts failed for provider ${provider}`)
  }
}

// ─── Embedding (always OpenAI) ──────────────────────────────────

function getEmbeddingClient(): OpenAI {
  if (clients['_embed']) return clients['_embed']
  clients['_embed'] = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return clients['_embed']
}

// ─── Public API ─────────────────────────────────────────────────

export interface GatewayOptions {
  /** @deprecated Model routing is now handled by resolveAgentModel() at the call site. */
  modelPreference?: string
}

export function createGatewayClient(
  tenantId: string,
  options: GatewayOptions = {},
): GatewayClient {
  void tenantId
  void options
  // Model routing is now handled by resolveAgentModel() at the call site.
  // The gateway no longer applies preference overrides — agents pass the
  // already-resolved provider/model directly.

  return {
    async generate(opts) {
      const messages: OpenAI.ChatCompletionMessageParam[] = []
      if (opts.system) messages.push({ role: 'system', content: opts.system })
      for (const m of opts.messages) {
        messages.push({ role: m.role as 'user' | 'assistant', content: m.content })
      }

      log.info({ provider: opts.provider, model: opts.model }, 'AI request')

      return callWithRetry(opts.provider, opts.model, messages, opts.maxTokens ?? 20_000, opts.temperature ?? 0.7)
    },
    async embed(text: string) {
      const client = getEmbeddingClient()
      const response = await client.embeddings.create({ model: 'text-embedding-3-small', input: text })
      return response.data[0].embedding
    },
  }
}
