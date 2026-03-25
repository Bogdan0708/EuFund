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
  const parsed = parseAIJson<Record<string, unknown>>(result.content)
  enhancedIdea = {
    originalIdea: input,
    refinedDescription: (parsed.refinedDescription as string) || 'No description provided',
    sector: (parsed.sector as string) || 'General',
    region: (parsed.region as string) || 'National',
    targetGroup: (parsed.targetGroup as string) || 'General public',
    estimatedBudget: (parsed.estimatedBudget as string) || 'To be determined',
    keyObjectives: Array.isArray(parsed.keyObjectives) ? parsed.keyObjectives as string[] : ['Objective to be defined'],
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
