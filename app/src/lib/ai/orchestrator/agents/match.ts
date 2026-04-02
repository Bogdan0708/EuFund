import type { AgentFn, MatchedCall } from '../types'
import { getMatchPrompt } from '../prompts/match'
import { parseAIJson } from '../utils'

export const matchAgent: AgentFn = async (ctx, _input, stream, gateway) => {
  if (!ctx.enhancedIdea) {
    throw new Error('Enhanced idea required before matching')
  }

  stream.send({ type: 'step_progress', step: 2, message: 'Searching knowledge base for matching calls...' })

  // Build search query from enhanced idea
  const searchQuery = `${ctx.enhancedIdea.sector} ${ctx.enhancedIdea.region} ${ctx.enhancedIdea.keyObjectives.join(' ')} ${ctx.enhancedIdea.estimatedBudget}`

  // Step 1: Search Qdrant for relevant calls
  let ragResults: { content: string; metadata: Record<string, unknown>; score: number }[] = []
  try {
    const { hybridSearch } = await import('@/lib/rag/pipeline')
    ragResults = await hybridSearch({ query: searchQuery, topK: 10 })
  } catch {
    stream.send({ type: 'step_progress', step: 2, message: 'Knowledge base unavailable, searching the web...' })
  }

  let ragContext = ragResults.map(r => `[${r.metadata?.program || 'Unknown'}] ${r.content} (score: ${r.score.toFixed(2)})`).join('\n\n')

  // Step 2: If no RAG results, search the web for open funding calls via Perplexity
  if (ragResults.length === 0) {
    stream.send({ type: 'step_progress', step: 2, message: 'Searching Romanian funding platforms for open calls...' })

    try {
      const webResult = await gateway.generate({
        provider: 'perplexity',
        model: 'sonar-pro',
        system: `You are a Romanian EU funding specialist. Search for currently OPEN funding calls (apeluri de proiecte deschise) that match the project description below.
Search on official platforms: mysmis2021.gov.ro, mfe.gov.ro, and other Romanian funding sources.
For each call found, provide: the exact call title in Romanian, the program name (PNRR, PEO, POCIDIF, POTJ, PR-*, etc.), estimated budget range, deadline if known, and the source URL.
Return ONLY a valid JSON array with fields: title, program, budgetRange, deadline, sourceUrl, description.
If you cannot find any matching open calls, return an empty array [].`,
        messages: [{
          role: 'user',
          content: `Find open EU funding calls in Romania matching this project:\n\nSector: ${ctx.enhancedIdea.sector}\nRegion: ${ctx.enhancedIdea.region}\nDescription: ${ctx.enhancedIdea.refinedDescription}\nBudget: ${ctx.enhancedIdea.estimatedBudget}\nObjectives: ${ctx.enhancedIdea.keyObjectives.join(', ')}`,
        }],
        temperature: 0.1,
        maxTokens: 4000,
      })

      // Parse web results and format as RAG context
      try {
        const webCalls = parseAIJson<{ title: string; program: string; budgetRange?: string; deadline?: string; sourceUrl?: string; description?: string }[]>(webResult.content)
        if (Array.isArray(webCalls) && webCalls.length > 0) {
          ragContext = webCalls.map(c =>
            `[${c.program}] ${c.title} - ${c.description || ''} Budget: ${c.budgetRange || 'N/A'}, Deadline: ${c.deadline || 'N/A'}, Source: ${c.sourceUrl || 'N/A'}`
          ).join('\n\n')
          stream.send({ type: 'step_progress', step: 2, message: `Found ${webCalls.length} potential calls from web search, scoring...` })
        }
      } catch {
        // If parsing fails, use raw text as context
        ragContext = webResult.content
      }
    } catch (webErr) {
      stream.send({ type: 'step_progress', step: 2, message: 'Web search failed, using AI knowledge only...' })
    }
  } else {
    stream.send({ type: 'step_progress', step: 2, message: `Found ${ragResults.length} potential matches, scoring...` })
  }

  // Step 3: Score and rank matches with Gemini
  const result = await gateway.generate({
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    system: getMatchPrompt(ctx),
    messages: [{
      role: 'user',
      content: `PROJECT:\n${JSON.stringify(ctx.enhancedIdea, null, 2)}\n\nAVAILABLE CALLS:\n${ragContext || 'No calls found. Search your knowledge of Romanian EU funding programs (PNRR, PEO, POCIDIF, POTJ, PR-*, POIM, etc.) and suggest the most likely matching open calls. Generate realistic entries with callId, title, program, scores, and reasoning.'}`,
    }],
    temperature: 0.2,
  })

  let matchedCalls: MatchedCall[]
  try {
    matchedCalls = parseAIJson<MatchedCall[]>(result.content)
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
