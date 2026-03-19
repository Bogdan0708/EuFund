import type { AgentFn, MatchedCall } from '../types'
import { getMatchPrompt } from '../prompts/match'

export const matchAgent: AgentFn = async (ctx, input, stream, gateway) => {
  if (!ctx.enhancedIdea) {
    throw new Error('Enhanced idea required before matching')
  }

  stream.send({ type: 'step_progress', step: 2, message: 'Searching knowledge base for matching calls...' })

  // Build search query from enhanced idea
  const searchQuery = `${ctx.enhancedIdea.sector} ${ctx.enhancedIdea.region} ${ctx.enhancedIdea.keyObjectives.join(' ')} ${ctx.enhancedIdea.estimatedBudget}`

  // Search Qdrant for relevant calls
  let ragResults: { content: string; metadata: Record<string, unknown>; score: number }[] = []
  try {
    const { hybridSearch } = await import('@/lib/rag/pipeline')
    ragResults = await hybridSearch(searchQuery, { limit: 10 })
  } catch {
    stream.send({ type: 'step_progress', step: 2, message: 'Knowledge base search unavailable, using AI matching only...' })
  }

  stream.send({ type: 'step_progress', step: 2, message: `Found ${ragResults.length} potential matches, scoring...` })

  // Use AI to score and rank matches
  const ragContext = ragResults.map(r => `[${r.metadata?.program || 'Unknown'}] ${r.content} (score: ${r.score.toFixed(2)})`).join('\n\n')

  const result = await gateway.generate({
    provider: 'gemini',
    model: 'gemini-2.5-flash-preview',
    system: getMatchPrompt(ctx),
    messages: [{
      role: 'user',
      content: `PROJECT:\n${JSON.stringify(ctx.enhancedIdea, null, 2)}\n\nAVAILABLE CALLS:\n${ragContext || 'No calls found in database. Return empty array.'}`,
    }],
    temperature: 0.2,
  })

  let matchedCalls: MatchedCall[]
  try {
    matchedCalls = JSON.parse(result.content)
  } catch {
    throw new Error('Failed to parse AI response for call matching')
  }

  // Stream results to user
  const summary = matchedCalls.map((c, i) =>
    `${i + 1}. **${c.title}** (${c.program}) — Score: ${c.score}/100\n   ${c.reasoning}`
  ).join('\n\n')

  stream.send({ type: 'ai_chunk', step: 2, content: summary || 'No matching calls found.' })

  return {
    data: { matchedCalls },
    checkpoint: matchedCalls.length > 0 ? {
      question: ctx.locale === 'ro'
        ? 'Selectează apelul de finanțare pentru care dorești să construiești proiectul:'
        : 'Select the funding call you want to build your project for:',
      options: matchedCalls.map(c => ({
        id: c.callId,
        label: `${c.title} (${c.program})`,
        description: c.reasoning,
      })),
      type: 'select' as const,
    } : null,
    tokensUsed: result.tokensUsed,
  }
}
