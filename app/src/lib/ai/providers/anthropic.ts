import OpenAI from 'openai'
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions/completions'
import type { ProviderClient, GenerateRequest, GenerateResult } from './types'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: 'https://api.anthropic.com/v1/',
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: { 'anthropic-version': '2023-06-01' },
    })
  }
  return client
}

export const anthropicProvider: ProviderClient = {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const c = getClient()
    const messages = [
      ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
      ...req.messages,
    ]
    const response = await c.chat.completions.create({
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 4096,
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
        ?.filter(tc => tc.type === 'function')
        .map(tc => {
          const ftc = tc as ChatCompletionMessageFunctionToolCall
          return { id: ftc.id, name: ftc.function.name, arguments: ftc.function.arguments }
        }),
    }
  },
}
