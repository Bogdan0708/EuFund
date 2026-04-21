import OpenAI from 'openai'
import type { ProviderClient, GenerateRequest, GenerateResult } from './types'
import { deriveIdentityKey } from './cache-key'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return client
}

export const openaiProvider: ProviderClient = {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const c = getClient()

    const messages = [
      ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
      ...req.messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id || '' }
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          return {
            role: 'assistant' as const,
            content: m.content,
            tool_calls: m.tool_calls.map((tc) => ({
              id: tc.id,
              type: tc.type,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          }
        }
        return { role: m.role, content: m.content }
      }),
    ] as OpenAI.ChatCompletionMessageParam[]

    const identityKey = req.cache ? deriveIdentityKey(req) : undefined

    const createParams: OpenAI.ChatCompletionCreateParams & { prompt_cache_key?: string } = {
      model: req.model,
      messages,
      max_completion_tokens: req.maxTokens ?? 20_000,
      temperature: req.temperature ?? 0.7,
      ...(req.tools ? { tools: req.tools } : {}),
      ...(req.cache?.enabled && identityKey
        ? { prompt_cache_key: req.cache.key ?? identityKey }
        : {}),
    }

    const response = await c.chat.completions.create(createParams)
    const choice = response.choices[0]

    const result: GenerateResult = {
      content: choice.message.content ?? '',
      tokensUsed: { input: response.usage?.prompt_tokens ?? 0, output: response.usage?.completion_tokens ?? 0 },
      model: req.model,
      provider: 'openai',
      toolCalls: choice.message.tool_calls
        ?.filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
        .map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })),
    }

    // Adapter emits cacheUsage only when the caller opted in (§5.2, §5.4).
    // Router owns the disabled presence for cache.enabled=false and kill-switch cases.
    if (req.cache?.enabled === true && identityKey) {
      const usage = response.usage as
        | (typeof response.usage & { prompt_tokens_details?: { cached_tokens?: number } })
        | undefined
      const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0
      result.cacheUsage = {
        requested: true,
        enabled: true,
        disabledReason: 'none',
        identityKey,
        supported: true,
        reads: cachedTokens,
        writes: 0,
        hit: cachedTokens > 0 ? 'read' : 'miss',
        ...(req.cache.ttlSeconds !== undefined ? { effectiveTtlSeconds: req.cache.ttlSeconds } : {}),
      }
    }

    return result
  },
  async embed(text: string): Promise<number[]> {
    const c = getClient()
    const res = await c.embeddings.create({ model: 'text-embedding-3-small', input: text })
    return res.data[0].embedding
  },
}
