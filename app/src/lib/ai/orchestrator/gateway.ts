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

// ─── Embedding client (always OpenAI) ───────────────────────────

function getEmbeddingClient(): OpenAI {
  if (clients['_embed']) return clients['_embed']
  clients['_embed'] = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return clients['_embed']
}

// ─── Public API ─────────────────────────────────────────────────

export function createGatewayClient(_tenantId: string): GatewayClient {
  return {
    async generate(opts) {
      const client = getClient(opts.provider)

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

      const response = await client.chat.completions.create({
        model: opts.model,
        messages,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
      })

      const content = response.choices?.[0]?.message?.content ?? ''
      const tokensUsed = response.usage?.total_tokens ?? 0

      return { content, tokensUsed }
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
