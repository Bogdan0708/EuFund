import OpenAI from 'openai'
import type { ProviderClient, GenerateRequest, GenerateResult } from './types'
import { anthropicNativeGenerate } from './anthropic-native'

let shimClient: OpenAI | null = null
function getShimClient(): OpenAI {
  if (!shimClient) {
    shimClient = new OpenAI({
      baseURL: 'https://api.anthropic.com/v1/',
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: { 'anthropic-version': '2023-06-01' },
    })
  }
  return shimClient
}

async function anthropicCompatGenerate(req: GenerateRequest): Promise<GenerateResult> {
  const c = getShimClient()
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
  const response = await c.chat.completions.create({
    model: req.model,
    messages,
    max_completion_tokens: req.maxTokens ?? 20_000,
    temperature: req.temperature ?? 0.7,
    ...(req.tools ? { tools: req.tools } : {}),
  })
  const choice = response.choices[0]
  return {
    content: choice.message.content ?? '',
    tokensUsed: { input: response.usage?.prompt_tokens ?? 0, output: response.usage?.completion_tokens ?? 0 },
    model: req.model,
    provider: 'anthropic',
    toolCalls: choice.message.tool_calls
      ?.filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
      .map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })),
  }
}

export const anthropicProvider: ProviderClient = {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (req.cache?.enabled === true) return anthropicNativeGenerate(req)
    return anthropicCompatGenerate(req)
  },
}
