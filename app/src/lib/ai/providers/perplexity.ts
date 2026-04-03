import OpenAI from 'openai'
import type { ProviderClient, GenerateRequest, GenerateResult } from './types'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: 'https://api.perplexity.ai/',
      apiKey: process.env.PERPLEXITY_API_KEY,
    })
  }
  return client
}

export const perplexityProvider: ProviderClient = {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
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
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      ...(req.tools ? { tools: req.tools } : {}),
    })
    const choice = response.choices[0]
    return {
      content: choice.message.content ?? '',
      tokensUsed: { input: response.usage?.prompt_tokens ?? 0, output: response.usage?.completion_tokens ?? 0 },
      model: req.model,
      provider: 'perplexity',
      toolCalls: choice.message.tool_calls
        ?.filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
        .map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })),
    }
  },
}
