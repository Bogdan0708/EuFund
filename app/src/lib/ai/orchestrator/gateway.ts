import { aiGenerate, aiEmbed } from '@/lib/ai/client-v2'
import type { GatewayClient } from './types'

export function createGatewayClient(tenantId: string): GatewayClient {
  return {
    async generate(opts) {
      const result = await aiGenerate({
        provider: opts.provider,
        model: opts.model,
        system: opts.system,
        messages: opts.messages,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        tenantId,
      })
      return {
        content: result.content,
        tokensUsed: result.usage?.totalTokens || 0,
      }
    },

    async embed(text: string) {
      return aiEmbed(text)
    },
  }
}
