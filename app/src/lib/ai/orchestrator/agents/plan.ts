import type { AgentFn } from '../types'
import { getPlanPrompt } from '../prompts/plan'

export const planAgent: AgentFn = async (ctx, _input, stream, gateway) => {
  if (!ctx.matchedCalls || !ctx.researchResults) {
    throw new Error('Matched calls and research results required for planning')
  }

  const selectedCall = ctx.matchedCalls[0]
  stream.send({ type: 'step_progress', step: 6, message: 'Creating your action plan...' })

  const result = await gateway.generate({
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    system: getPlanPrompt(ctx),
    messages: [{ role: 'user', content: `Create an action plan for:\n\nProject: ${JSON.stringify(ctx.enhancedIdea)}\n\nCall: ${JSON.stringify(selectedCall)}\n\nResearch: ${JSON.stringify(ctx.researchResults)}` }],
    temperature: 0.3,
    maxTokens: 4000,
  })

  let actionPlan
  try {
    actionPlan = JSON.parse(result.content)
  } catch {
    throw new Error('Failed to parse action plan from AI response')
  }

  const stepList = actionPlan.steps?.map((s: { order: number; title: string }) => `${s.order}. ${s.title}`).join('\n') || ''
  stream.send({ type: 'ai_chunk', step: 6, content: `Action Plan:\n${stepList}\n\nEstimated timeline: ${actionPlan.estimatedTimeline}` })

  return {
    data: { actionPlan },
    checkpoint: {
      question: ctx.locale === 'ro'
        ? 'Ești de acord cu acest plan de acțiune? Putem continua cu construirea proiectului.'
        : 'Do you agree with this action plan? We can proceed to build the project.',
      type: 'confirm' as const,
    },
    tokensUsed: result.tokensUsed,
  }
}
