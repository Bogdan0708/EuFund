import type { AgentFn, MatchedCall } from '../types'
import { getMatchPrompt } from '../prompts/match'
import { parseAIJson } from '../utils'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'match-agent' })

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

  // Track whether a live Perplexity web search produced the call data.
  // When true, the calls are already fresh and don't need a freshness check.
  // Only set when the web search actually succeeds and parses — failed web search
  // or Gemini-from-knowledge calls are NOT "live" and still need verification.
  let callsFromLiveWebSearch = false

  // Step 2: If no RAG results, search the web for open funding calls via Perplexity
  if (ragResults.length === 0) {
    stream.send({ type: 'step_progress', step: 2, message: 'Searching Romanian funding platforms for open calls...' })

    try {
      const webRouted = resolveAgentModel({ task: 'freshness_check' })
      const webResult = await gateway.generate({
        provider: webRouted.provider,
        model: webRouted.model,
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
        maxTokens: 20_000,
      })

      // Parse web results and format as RAG context
      try {
        const webCalls = parseAIJson<{ title: string; program: string; budgetRange?: string; deadline?: string; sourceUrl?: string; description?: string }[]>(webResult.content)
        if (Array.isArray(webCalls) && webCalls.length > 0) {
          ragContext = webCalls.map(c =>
            `[${c.program}] ${c.title} - ${c.description || ''} Budget: ${c.budgetRange || 'N/A'}, Deadline: ${c.deadline || 'N/A'}, Source: ${c.sourceUrl || 'N/A'}`
          ).join('\n\n')
          callsFromLiveWebSearch = true
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

  // Step 3: Score and rank matches
  const matchRouted = resolveAgentModel({ task: 'matching', ctx: ctx.routingCtx })
  const result = await gateway.generate({
    provider: matchRouted.provider,
    model: matchRouted.model,
    system: getMatchPrompt(ctx),
    messages: [{
      role: 'user',
      content: `PROJECT:\n${JSON.stringify(ctx.enhancedIdea, null, 2)}\n\nAVAILABLE CALLS:\n${ragContext || 'No calls found. Search your knowledge of Romanian EU funding programs (PNRR, PEO, POCIDIF, POTJ, PR-*, POIM, etc.) and suggest the most likely matching open calls. Generate realistic entries with callId, title, program, scores, and reasoning.'}`,
    }],
    temperature: 0.2,
    maxTokens: 32_000,
  })

  let matchedCalls: MatchedCall[] = []
  log.info({ responseLength: result.content.length, preview: result.content.slice(0, 300) }, 'Gemini match response')
  try {
    const parsed = parseAIJson<unknown>(result.content)
    log.info({ parsedType: typeof parsed, isArray: Array.isArray(parsed), keys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed as Record<string, unknown>) : null }, 'Parsed match result')
    // Normalize: AI may return a plain array, or wrap it in an object
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object')
        ? (Array.isArray((parsed as Record<string, unknown>).calls) ? (parsed as Record<string, unknown>).calls
          : Array.isArray((parsed as Record<string, unknown>).matchedCalls) ? (parsed as Record<string, unknown>).matchedCalls
          : Array.isArray((parsed as Record<string, unknown>).results) ? (parsed as Record<string, unknown>).results
          : Object.values(parsed as Record<string, unknown>).find(v => Array.isArray(v)))
        : null

    if (Array.isArray(arr)) {
      matchedCalls = (arr as Record<string, unknown>[]).map((c, i) => ({
        callId: String(c.callId || c.id || `call-${i + 1}`),
        title: String(c.title || 'Unknown Call'),
        program: String(c.program || 'Unknown'),
        score: Number(c.score) || 0,
        thematicFit: Number(c.thematicFit) || 0,
        eligibilityFit: Number(c.eligibilityFit) || 0,
        budgetFit: Number(c.budgetFit) || 0,
        deadline: String(c.deadline || 'TBD'),
        sourceUrl: String(c.sourceUrl || ''),
        reasoning: String(c.reasoning || ''),
      }))
    }
  } catch {
    // Parsing failed — matchedCalls stays empty
  }

  // ─── Step 4: Freshness check (top 3 calls) ───
  // Skip only if calls came from a successful Perplexity web search (data is already live).
  // Failed web search or Gemini-from-knowledge calls still need verification.
  if (!callsFromLiveWebSearch && matchedCalls.length > 0) {
    stream.send({ type: 'step_progress', step: 2, message: 'Verifying call freshness...' })
    try {
      const { checkCallFreshness } = await import('../freshness')
      matchedCalls = await checkCallFreshness(matchedCalls, gateway)
    } catch (freshErr) {
      log.warn({ error: freshErr instanceof Error ? freshErr.message : String(freshErr) }, 'Freshness check failed entirely')
    }
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
