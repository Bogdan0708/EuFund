import type { AgentFn, CallBlueprint, SectionSpec } from '../types'
import { getResearchPrompt, getNotebookLmQuery, getPerplexityFreshnessQuery } from '../prompts/research'
import { parseAIJson } from '../utils'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { DEFAULT_SECTIONS } from '../section-specs'
import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'research-agent' })

function computeStructureConfidence(data: Record<string, unknown>): number {
  let score = 0
  const sections = data.requiredSections as unknown[]
  const grid = data.evaluationGrid as unknown[]
  const annexes = data.mandatoryAnnexes as unknown[]
  const criteria = data.eligibilityCriteria as unknown[]
  const rate = data.cofinancingRate as number

  if (Array.isArray(sections) && sections.length >= 5) score += 0.3
  if (Array.isArray(grid) && grid.length >= 3) score += 0.25
  if (Array.isArray(annexes) && annexes.length >= 2) score += 0.15
  if (typeof rate === 'number' && rate > 0) score += 0.15
  if (Array.isArray(criteria) && criteria.length >= 3) score += 0.15
  return Math.min(score, 1)
}

function buildNormalizedSections(
  rawSections: { title: string; description: string; evaluationWeight?: number }[],
  confidence: number,
): SectionSpec[] {
  if (!rawSections || rawSections.length === 0) return DEFAULT_SECTIONS

  return rawSections.map((s, i) => ({
    id: s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    title: s.title,
    description: s.description || '',
    order: i + 1,
    generationOrder: i + 1,
    importance: (s.evaluationWeight && s.evaluationWeight >= 15) ? 'critical' as const : 'standard' as const,
    expectedLength: (s.evaluationWeight && s.evaluationWeight >= 20) ? 'long' as const : 'medium' as const,
    dependsOn: [],
    modelHint: (s.evaluationWeight && s.evaluationWeight >= 15) ? 'heavy' as const : 'light' as const,
    evaluationWeight: s.evaluationWeight,
    mandatory: true,
    confidence,
  }))
}

export const researchAgent: AgentFn = async (ctx, input, stream, gateway) => {
  if (!ctx.matchedCalls || ctx.matchedCalls.length === 0) {
    throw new Error('No matched calls for research')
  }

  const selectedCall = (ctx.selectedCallId && ctx.matchedCalls.find(c => c.callId === ctx.selectedCallId)) || ctx.matchedCalls[0]

  stream.send({ type: 'step_progress', step: 3, message: `Researching requirements for ${selectedCall.title}...` })

  let notebookLmResponse = ''
  let perplexityResponse = ''
  let cachedData: typeof callKnowledge.$inferSelect | null = null

  // 1. Check cache
  try {
    const [cached] = await db.select().from(callKnowledge).where(eq(callKnowledge.callId, selectedCall.callId)).limit(1)
    if (cached) cachedData = cached
  } catch {
    log.warn('call_knowledge cache lookup failed')
  }

  // 2. Research query (skip if cached)
  if (!cachedData) {
    stream.send({ type: 'step_progress', step: 3, message: 'Querying knowledge base for call structure...' })
    try {
      const researchRouted = resolveAgentModel({ task: 'freshness_check' })
      const researchResult = await gateway.generate({
        provider: researchRouted.provider,
        model: researchRouted.model,
        system: getResearchPrompt(ctx),
        messages: [{ role: 'user', content: getNotebookLmQuery(selectedCall.title, selectedCall.program) }],
        temperature: 0.1,
        maxTokens: 20_000,
      })
      notebookLmResponse = researchResult.content
    } catch (err) {
      log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Research query failed')
    }
  } else {
    notebookLmResponse = '[cached]'
    log.info({ callId: selectedCall.callId }, 'Using cached call_knowledge')
  }

  // 3. Freshness check (always)
  stream.send({ type: 'step_progress', step: 3, message: 'Verifying call status...' })
  try {
    const freshnessRouted = resolveAgentModel({ task: 'freshness_check' })
    const freshnessResult = await gateway.generate({
      provider: freshnessRouted.provider,
      model: freshnessRouted.model,
      system: 'You verify EU funding call status. Return JSON: { isOpen: boolean, amendments: string[], warnings: string[] }',
      messages: [{ role: 'user', content: getPerplexityFreshnessQuery(selectedCall.title, selectedCall.program) }],
      temperature: 0.1,
      maxTokens: 4_000,
    })
    perplexityResponse = freshnessResult.content
  } catch {
    perplexityResponse = '{"isOpen": true, "amendments": [], "warnings": ["Could not verify call status"]}'
  }

  // 4. Parse
  let rawParsed: Record<string, unknown> = {}
  if (cachedData) {
    const norm = (cachedData.normalized ?? {}) as Record<string, unknown>
    rawParsed = {
      requiredSections: norm.requiredSections || [],
      mandatoryAnnexes: norm.mandatoryAnnexes || [],
      eligibilityCriteria: norm.eligibilityCriteria || [],
      evaluationGrid: norm.evaluationGrid || [],
      cofinancingRate: norm.cofinancingRate || 0,
    }
  } else if (notebookLmResponse) {
    try { rawParsed = parseAIJson<Record<string, unknown>>(notebookLmResponse) } catch { rawParsed = {} }
  }

  let freshness = { isOpen: true, amendments: [] as string[], warnings: [] as string[] }
  try { freshness = parseAIJson<typeof freshness>(perplexityResponse) } catch {
    freshness = { isOpen: true, amendments: [], warnings: ['Could not parse freshness check'] }
  }

  // 5. Build CallBlueprint
  const requiredSections = (rawParsed.requiredSections as { title: string; description: string; evaluationWeight?: number }[]) || []
  const mandatoryAnnexes = (rawParsed.mandatoryAnnexes as string[]) || []
  const eligibilityCriteria = (rawParsed.eligibilityCriteria as string[]) || []
  const evaluationGrid = (rawParsed.evaluationGrid as { criterion: string; maxPoints: number }[]) || []
  const cofinancingRate = (rawParsed.cofinancingRate as number) || 0

  const structureConfidence = cachedData ? 0.85 : computeStructureConfidence(rawParsed)
  const normalizedSections = buildNormalizedSections(requiredSections, structureConfidence)

  const callBlueprint: CallBlueprint = {
    callId: selectedCall.callId,
    program: selectedCall.program,
    isOpen: freshness.isOpen,
    amendments: freshness.amendments,
    warnings: freshness.warnings,
    requiredSections,
    mandatoryAnnexes,
    eligibilityCriteria,
    evaluationGrid,
    cofinancingRate,
    eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
    sources: cachedData ? ['call_knowledge cache'] : ['perplexity research'],
    verifiedAt: new Date().toISOString(),
    raw: { notebookLmResponse: cachedData ? '[cached]' : notebookLmResponse, perplexityResponse, retrievedAt: new Date().toISOString() },
    normalized: { requiredSections: normalizedSections, mandatoryAnnexes, eligibilityCriteria, evaluationGrid, cofinancingRate },
    structureConfidence,
  }

  // 6. Cache (upsert)
  if (!cachedData && notebookLmResponse) {
    try {
      const normalizedData = { requiredSections, mandatoryAnnexes, eligibilityCriteria, evaluationGrid, cofinancingRate }
      await db.insert(callKnowledge).values({
        callId: selectedCall.callId,
        program: selectedCall.program,
        callTitle: selectedCall.title,
        normalized: normalizedData,
        extractedFrom: 'perplexity',
        structureConfidence,
      }).onConflictDoUpdate({
        target: callKnowledge.callId,
        set: {
          normalized: normalizedData,
          structureConfidence,
          contentExtractedAt: new Date(),
          updatedAt: new Date(),
        },
      })
    } catch (err) {
      log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to cache call_knowledge')
    }
  } else if (cachedData) {
    try {
      await db.update(callKnowledge).set({ freshnessCheckedAt: new Date(), updatedAt: new Date() }).where(eq(callKnowledge.callId, selectedCall.callId))
    } catch { /* best effort */ }
  }

  // 7. Stream
  const status = callBlueprint.isOpen ? 'OPEN' : 'CLOSED'
  stream.send({ type: 'ai_chunk', step: 3, content: `Call status: ${status}\nSections identified: ${normalizedSections.length}\nStructure confidence: ${(structureConfidence * 100).toFixed(0)}%\n${callBlueprint.warnings.length > 0 ? 'Warnings: ' + callBlueprint.warnings.join(', ') : ''}` })

  return { data: { callBlueprint }, checkpoint: null, tokensUsed: 0 }
}
