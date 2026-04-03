// app/src/lib/ai/agent/tools/resolve-call.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext, StateTransition } from '../types'
import type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
import { getVectorStore } from '@/lib/vectors/store'
import { generate } from '@/lib/ai/providers/router'
import { parseAIJson } from '../utils'
import { DEFAULT_SECTIONS } from '../section-specs'
import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-resolve-call' })

const inputSchema = z.object({
  callId: z.string().min(1),
  callTitle: z.string().optional(),
  program: z.string().optional(),
})

type Input = z.infer<typeof inputSchema>

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<CallBlueprint>> {
  const start = Date.now()

  try {
    // Step 1: Check cache
    const [cached] = await db.select().from(callKnowledge).where(eq(callKnowledge.callId, input.callId)).limit(1)

    if (cached && cached.structureConfidence >= 0.4) {
      const norm = (cached.normalized ?? {}) as Record<string, unknown>
      const blueprint = buildBlueprintFromCache(cached, norm)

      log.info({ callId: input.callId, source: 'cache', confidence: cached.structureConfidence }, 'Resolved from cache')

      return {
        success: true,
        data: blueprint,
        stateTransitions: [
          { type: 'SET_SELECTED_CALL', callId: input.callId },
          { type: 'SET_BLUEPRINT', blueprint },
          { type: 'SET_PHASE', phase: 'research' as const },
        ],
        checkpoint: { type: 'call_selected', payload: { callId: input.callId, source: 'cache' } },
        telemetry: { latencyMs: Date.now() - start },
      }
    }

    // Step 2: Retrieve evidence from Qdrant
    log.info({ callId: input.callId }, 'Cache miss, retrieving evidence')
    const store = getVectorStore()
    const evidence = await store.search(input.callId, 20, { callId: input.callId })

    // Broader search if filtered returns nothing
    const chunks = evidence.length > 0 ? evidence : await store.search(input.callTitle || input.callId, 20)

    // Step 3: Extract structure via LLM
    const evidenceText = chunks
      .map(c => `[${(c.metadata.documentType as string) || 'doc'}] ${c.content}`)
      .join('\n\n---\n\n')

    let sections: SectionSpec[] = DEFAULT_SECTIONS
    let structureConfidence = 0.3

    if (evidenceText.trim()) {
      try {
        const response = await generate({
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          system: 'Extract required application sections from EU funding call docs. Return a JSON array of objects with: id, title, description, order, generationOrder, importance ("critical"|"standard"|"supplementary"), expectedLength ("short"|"medium"|"long"), dependsOn (string[]), modelHint ("heavy"|"light"), mandatory (boolean), confidence (0-1).',
          messages: [{ role: 'user', content: `Call: ${input.callTitle || input.callId}\nProgram: ${input.program || 'Unknown'}\n\n${evidenceText}` }],
          temperature: 0.2,
          maxTokens: 4000,
        })
        const parsed = parseAIJson<SectionSpec[]>(response.content)
        if (Array.isArray(parsed) && parsed.length > 0) {
          sections = parsed
          structureConfidence = Math.min(0.85, sections.reduce((acc, s) => acc + (s.confidence || 0.5), 0) / sections.length)
        }
      } catch (err) {
        log.warn({ error: err instanceof Error ? err.message : String(err) }, 'LLM extraction failed, using defaults')
      }
    }

    // Step 4: Build blueprint
    const blueprint: CallBlueprint = {
      callId: input.callId,
      program: input.program || 'Unknown',
      isOpen: true,
      amendments: [],
      warnings: chunks.length === 0 ? ['No evidence found — using default structure'] : [],
      requiredSections: sections.map(s => ({ title: s.title, description: s.description, evaluationWeight: s.evaluationWeight })),
      mandatoryAnnexes: [],
      eligibilityCriteria: [],
      evaluationGrid: [],
      cofinancingRate: 0,
      eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
      sources: chunks.map(c => (c.metadata.source as string) || c.id),
      verifiedAt: new Date().toISOString(),
      raw: { notebookLmResponse: '', perplexityResponse: '', retrievedAt: new Date().toISOString() },
      normalized: { requiredSections: sections, mandatoryAnnexes: [], eligibilityCriteria: [], evaluationGrid: [], cofinancingRate: 0 },
      structureConfidence,
    }

    // Step 5: Cache result
    try {
      await db.insert(callKnowledge).values({
        callId: input.callId,
        program: input.program || 'Unknown',
        callTitle: input.callTitle || input.callId,
        normalized: { requiredSections: sections },
        status: 'provisional',
        extractedFrom: 'qdrant_obsidian',
        structureConfidence,
        sourceDocs: chunks.map(c => (c.metadata.source as string) || c.id),
      }).onConflictDoUpdate({
        target: callKnowledge.callId,
        set: {
          normalized: { requiredSections: sections },
          structureConfidence,
          contentExtractedAt: new Date(),
          updatedAt: new Date(),
        },
      })
    } catch (dbErr) {
      log.warn({ error: dbErr instanceof Error ? dbErr.message : String(dbErr) }, 'Failed to cache blueprint')
    }

    log.info({ callId: input.callId, source: 'resolved', confidence: structureConfidence, sections: sections.length }, 'Call resolved')

    const transitions: StateTransition[] = [
      { type: 'SET_SELECTED_CALL', callId: input.callId },
      { type: 'SET_BLUEPRINT', blueprint },
      { type: 'SET_OUTLINE', outline: sections },
      { type: 'SET_PHASE', phase: 'research' as const },
    ]

    return {
      success: true,
      data: blueprint,
      stateTransitions: transitions,
      checkpoint: { type: 'call_selected', payload: { callId: input.callId, source: 'resolved', confidence: structureConfidence } },
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error({ callId: input.callId, error: error instanceof Error ? error.message : String(error) }, 'resolve_call failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resolve call',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

function buildBlueprintFromCache(
  row: typeof callKnowledge.$inferSelect,
  norm: Record<string, unknown>,
): CallBlueprint {
  const requiredSections = (norm.requiredSections ?? []) as { title: string; description: string; evaluationWeight?: number }[]
  const mandatoryAnnexes = (norm.mandatoryAnnexes ?? []) as string[]
  const eligibilityCriteria = (norm.eligibilityCriteria ?? []) as string[]
  const evaluationGrid = (norm.evaluationGrid ?? []) as { criterion: string; maxPoints: number }[]
  const cofinancingRate = (norm.cofinancingRate ?? 0) as number

  return {
    callId: row.callId,
    program: row.program,
    isOpen: true,
    amendments: [],
    warnings: [],
    requiredSections,
    mandatoryAnnexes,
    eligibilityCriteria,
    evaluationGrid,
    cofinancingRate,
    eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
    sources: (row.sourceDocs as string[]) || [],
    verifiedAt: row.contentExtractedAt.toISOString(),
    raw: { notebookLmResponse: '[cached]', perplexityResponse: '', retrievedAt: row.contentExtractedAt.toISOString() },
    normalized: { requiredSections: (norm.requiredSections ?? []) as SectionSpec[], mandatoryAnnexes, eligibilityCriteria, evaluationGrid, cofinancingRate },
    structureConfidence: row.structureConfidence,
  }
}

registerTool({
  name: 'resolve_call',
  category: 'decision',
  description: 'Resolve a funding call by ID — retrieves or builds its blueprint from knowledge base',
  inputSchema,
  execute: execute as any,
  timeout: 90_000,
})
