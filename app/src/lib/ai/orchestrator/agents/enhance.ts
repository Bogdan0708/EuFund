import type { AgentFn, EnhancedIdea } from '../types'
import { getEnhancePrompt } from '../prompts/enhance'
import { parseAIJson } from '../utils'

export const enhanceAgent: AgentFn = async (ctx, input, stream, gateway) => {
  stream.send({ type: 'step_progress', step: 1, message: 'Analyzing your project idea...' })

  const result = await gateway.generate({
    provider: 'gemini',
    model: 'gemini-2.5-flash-preview',
    system: getEnhancePrompt(ctx),
    messages: [{ role: 'user', content: input }],
    temperature: 0.3,
  })

  let enhancedIdea: EnhancedIdea
  try {
    const parsed = parseAIJson<Record<string, unknown>>(result.content)
    enhancedIdea = {
      originalIdea: input,
      refinedDescription: parsed.refinedDescription as string,
      sector: parsed.sector as string,
      region: parsed.region as string,
      targetGroup: parsed.targetGroup as string,
      estimatedBudget: parsed.estimatedBudget as string,
      keyObjectives: parsed.keyObjectives as string[],
    }
  } catch {
    throw new Error('Failed to parse AI response for idea enhancement')
  }

  stream.send({
    type: 'step_progress',
    step: 1,
    message: `Project refined: ${enhancedIdea.sector} sector, ${enhancedIdea.region} region`,
  })

  const summary = ctx.locale === 'ro'
    ? `Am îmbunătățit ideea ta de proiect:\n\n**${enhancedIdea.refinedDescription}**\n\nSector: ${enhancedIdea.sector}\nRegiune: ${enhancedIdea.region}\nGrup țintă: ${enhancedIdea.targetGroup}\nBuget estimat: ${enhancedIdea.estimatedBudget}\n\nObiective:\n${enhancedIdea.keyObjectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
    : `I've refined your project idea:\n\n**${enhancedIdea.refinedDescription}**\n\nSector: ${enhancedIdea.sector}\nRegion: ${enhancedIdea.region}\nTarget group: ${enhancedIdea.targetGroup}\nEstimated budget: ${enhancedIdea.estimatedBudget}\n\nObjectives:\n${enhancedIdea.keyObjectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}`

  stream.send({ type: 'ai_chunk', step: 1, content: summary })

  return {
    data: { enhancedIdea },
    checkpoint: null,
    tokensUsed: result.tokensUsed,
  }
}
