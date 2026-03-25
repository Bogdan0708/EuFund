import type { AgentFn, ProjectSection } from '../types'
import { getBuildPrompt } from '../prompts/build'
import { parseAIJson } from '../utils'

export const buildAgent: AgentFn = async (ctx, _input, stream, gateway) => {
  if (!ctx.actionPlan || !ctx.enhancedIdea) {
    throw new Error('Action plan and enhanced idea required for building')
  }

  stream.send({ type: 'step_progress', step: 7, message: 'Building your project proposal...' })

  // Select model based on tier
  const model = (ctx.tier === 'pro' || ctx.tier === 'ultra')
    ? 'claude-sonnet-4-6'
    : 'gemini-2.5-flash-preview'
  const provider = (ctx.tier === 'pro' || ctx.tier === 'ultra') ? 'claude' : 'gemini'

  const result = await gateway.generate({
    provider,
    model,
    system: getBuildPrompt(ctx),
    messages: [{ role: 'user', content: `Build the complete project proposal for:\n\nProject: ${JSON.stringify(ctx.enhancedIdea)}\n\nAction Plan: ${JSON.stringify(ctx.actionPlan)}\n\nResearch: ${JSON.stringify(ctx.researchResults)}` }],
    temperature: 0.4,
    maxTokens: 8000,
  })

  let projectSections: ProjectSection[]
  try {
    projectSections = parseAIJson<ProjectSection[]>(result.content)
  } catch {
    throw new Error('Failed to parse project sections from AI response')
  }

  // Stream each section to the user
  for (const section of projectSections) {
    stream.send({ type: 'ai_chunk', step: 7, content: `## ${section.title}\n\n${section.content}\n\n---\n` })
  }

  return {
    data: { projectSections },
    checkpoint: null,
    tokensUsed: result.tokensUsed,
  }
}
