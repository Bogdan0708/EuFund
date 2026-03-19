import { aiGenerate, aiEmbed } from '@/lib/ai/client-v2'
import type { GatewayClient } from './types'

export function createGatewayClient(tenantId: string): GatewayClient {
  void tenantId
  return {
    async generate(opts) {
      // Convert messages array to single prompt for client-v2
      const prompt = opts.messages.map(m =>
        m.role === 'user' ? m.content : `[${m.role}]: ${m.content}`
      ).join('\n\n')

      const result = await aiGenerate({
        system: opts.system,
        prompt,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      })
      return {
        content: result.text,
        tokensUsed: result.tokensUsed,
      }
    },

    async embed(text: string) {
      return aiEmbed(text)
    },
  }
}
