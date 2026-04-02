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
      clients[provider] = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })
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
      clients[provider] = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })
  }

  return clients[provider]
}

// ─── Fallback providers ─────────────────────────────────────────

const FALLBACK_PROVIDER: Record<string, { provider: string; model: string }> = {
  perplexity: { provider: 'gemini', model: 'gemini-2.5-flash' },
  claude:     { provider: 'gemini', model: 'gemini-2.5-flash' },
  gemini:     { provider: 'claude', model: 'claude-sonnet-4-6' },
  openai:     { provider: 'gemini', model: 'gemini-2.5-flash' },
}

// ─── Embedding client (always OpenAI) ───────────────────────────

function getEmbeddingClient(): OpenAI {
  if (clients['_embed']) return clients['_embed']
  clients['_embed'] = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return clients['_embed']
}

// ─── Retry helper ───────────────────────────────────────────────

async function callWithRetry(
  provider: string,
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  maxTokens: number,
  temperature: number,
): Promise<{ content: string; tokensUsed: number }> {
  // Attempt 1: primary provider
  try {
    return await singleCall(provider, model, messages, maxTokens, temperature)
  } catch (err) {
    log.warn({ provider, model, error: err instanceof Error ? err.message : String(err) }, 'Primary call failed, retrying...')
  }

  // Attempt 2: retry same provider after 1s backoff
  await new Promise(r => setTimeout(r, 1000))
  try {
    return await singleCall(provider, model, messages, maxTokens, temperature)
  } catch (err) {
    log.warn({ provider, model, error: err instanceof Error ? err.message : String(err) }, 'Retry failed, trying fallback provider')
  }

  // Attempt 3: fallback provider
  const fallback = FALLBACK_PROVIDER[provider]
  if (fallback) {
    log.info({ from: provider, to: fallback.provider, model: fallback.model }, 'Falling back to alternate provider')
    return await singleCall(fallback.provider, fallback.model, messages, maxTokens, temperature)
  }

  throw new Error(`All attempts failed for provider ${provider}`)
}

async function singleCall(
  provider: string,
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  maxTokens: number,
  temperature: number,
): Promise<{ content: string; tokensUsed: number }> {
  const client = getClient(provider)
  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  })
  const content = response.choices?.[0]?.message?.content ?? ''
  const tokensUsed = response.usage?.total_tokens ?? 0
  return { content, tokensUsed }
}

// ─── Public API ─────────────────────────────────────────────────

export function createGatewayClient(_tenantId: string): GatewayClient {
  return {
    async generate(opts) {
      const messages: OpenAI.ChatCompletionMessageParam[] = []
      if (opts.system) {
        messages.push({ role: 'system', content: opts.system })
      }
      for (const m of opts.messages) {
        messages.push({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })
      }

      log.info({ provider: opts.provider, model: opts.model }, 'AI request')

      return callWithRetry(
        opts.provider,
        opts.model,
        messages,
        opts.maxTokens ?? 4096,
        opts.temperature ?? 0.7,
      )
    },

    async embed(text: string) {
      const client = getEmbeddingClient()
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      })
      return response.data[0].embedding
    },
  }
}
