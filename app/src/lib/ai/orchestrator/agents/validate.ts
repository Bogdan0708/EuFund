import type { AgentFn } from '../types'
import { getValidatePrompt } from '../prompts/validate'
import { parseAIJson } from '../utils'

export const validateAgent: AgentFn = async (ctx, input, stream, gateway) => {
  if (!ctx.matchedCalls || ctx.matchedCalls.length === 0) {
    throw new Error('No matched calls to validate')
  }

  // Use the selected call (from checkpoint) or the top match
  const selectedCallId = input || ctx.matchedCalls[0].callId
  const selectedCall = ctx.matchedCalls.find(c => c.callId === selectedCallId) || ctx.matchedCalls[0]

  stream.send({ type: 'step_progress', step: 3, message: `Verifying status of ${selectedCall.title}...` })

  const result = await gateway.generate({
    provider: 'perplexity',
    model: 'sonar',
    system: getValidatePrompt(ctx),
    messages: [{ role: 'user', content: `Verify the current status of: "${selectedCall.title}" from program ${selectedCall.program}. Source URL: ${selectedCall.sourceUrl}` }],
    temperature: 0.1,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let validationResults: any[]
  try {
    const parsed = parseAIJson<Record<string, unknown>>(result.content)
    validationResults = [{ callId: selectedCall.callId, ...parsed }]
  } catch {
    validationResults = [{ callId: selectedCall.callId, isOpen: true, lastVerified: new Date().toISOString(), updates: [], warnings: ['Could not verify call status automatically'] }]
  }

  const status = validationResults[0].isOpen ? '✅ Open' : '❌ Closed'
  stream.send({ type: 'ai_chunk', step: 3, content: `Call status: ${status}\n${validationResults[0].warnings.length > 0 ? 'Warnings: ' + validationResults[0].warnings.join(', ') : 'No warnings.'}` })

  return { data: { validationResults }, checkpoint: null, tokensUsed: result.tokensUsed }
}
