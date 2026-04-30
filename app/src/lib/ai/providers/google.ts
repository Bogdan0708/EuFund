import OpenAI from 'openai'
import { UnsupportedOperationError } from '@/lib/errors'
import { deriveIdentityKey } from './cache-key'
import type { ProviderClient, GenerateRequest, GenerateResult } from './types'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: process.env.GOOGLE_AI_API_KEY,
    })
  }
  return client
}

export const googleProvider: ProviderClient = {
  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    if (req.messages.some((m) => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0)) {
      throw new UnsupportedOperationError('google', 'tool_calls in messages')
    }
    const c = getClient()
    const messages = [
      ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
      ...req.messages.map(m => m.role === 'tool'
        ? { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id || '' }
        : { role: m.role, content: m.content }
      ),
    ] as OpenAI.ChatCompletionMessageParam[]
    const response = await c.chat.completions.create({
      model: req.model,
      messages,
      max_completion_tokens: req.maxTokens ?? 20_000,
      temperature: req.temperature ?? 0.7,
      ...(req.tools ? { tools: req.tools } : {}),
    }, signal ? { signal } : undefined)
    const choice = response.choices[0]
    const result: GenerateResult = {
      content: choice.message.content ?? '',
      tokensUsed: { input: response.usage?.prompt_tokens ?? 0, output: response.usage?.completion_tokens ?? 0 },
      model: req.model,
      provider: 'google',
      toolCalls: choice.message.tool_calls
        ?.filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
        .map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })),
    }

    // Adapter only emits cacheUsage when caller opted in with cache.enabled === true.
    // Router owns the disabled presence (§5.2) for cache.enabled === false / omitted.
    if (req.cache?.enabled === true) {
      result.cacheUsage = {
        requested: true,
        enabled: true,
        disabledReason: 'none',
        identityKey: deriveIdentityKey(req),
        supported: false,
        reads: 0,
        writes: 0,
        hit: 'unsupported',
        ...(req.cache.ttlSeconds !== undefined ? { effectiveTtlSeconds: req.cache.ttlSeconds } : {}),
      }
    }

    return result
  },
}
