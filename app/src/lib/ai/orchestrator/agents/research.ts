import type { AgentFn } from '../types'
import { getResearchPrompt } from '../prompts/research'
import { parseAIJson } from '../utils'

export const researchAgent: AgentFn = async (ctx, _input, stream, gateway) => {
  if (!ctx.matchedCalls || ctx.matchedCalls.length === 0) {
    throw new Error('No matched calls for research')
  }

  const selectedCall = ctx.matchedCalls[0]
  stream.send({ type: 'step_progress', step: 4, message: `Researching requirements for ${selectedCall.title}...` })

  const result = await gateway.generate({
    provider: 'perplexity',
    model: 'sonar-pro',
    system: getResearchPrompt(ctx),
    messages: [{ role: 'user', content: `Research all requirements for funding call: "${selectedCall.title}" (${selectedCall.program}). Source: ${selectedCall.sourceUrl}. Project concept: ${ctx.enhancedIdea?.refinedDescription}` }],
    temperature: 0.2,
    maxTokens: 4000,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let researchResults: any
  try {
    const parsed = parseAIJson<Record<string, unknown>>(result.content)
    researchResults = { callId: selectedCall.callId, ...parsed }
  } catch {
    researchResults = { callId: selectedCall.callId, requirements: [], forms: [], certificates: [], deadlines: [], additionalSections: [], rawFindings: result.content }
  }

  stream.send({ type: 'ai_chunk', step: 4, content: `Found ${researchResults.requirements.length} requirements, ${researchResults.forms.length} forms, ${researchResults.certificates.length} certificates needed.` })

  return { data: { researchResults }, checkpoint: null, tokensUsed: result.tokensUsed }
}
