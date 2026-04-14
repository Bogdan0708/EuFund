// app/src/lib/ai/agent/tools/resolve-call.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext, StateTransition } from '../types'
import type { CallBlueprint, SectionSpec } from '@/lib/ai/agent/types'
import { generate } from '@/lib/ai/providers/router'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { parseAIJson } from '../utils'
import { DEFAULT_SECTIONS } from '../section-specs'
import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { lookupBlueprint } from '../services/blueprint'
import { buildServiceContextFromToolCtx } from '../services/context-helpers'

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
    const svcCtx = buildServiceContextFromToolCtx(ctx)

    // Step 1: Delegate cache lookup and evidence retrieval to the blueprint service
    const lookup = await lookupBlueprint(svcCtx, input.callId)

    if (lookup.cached && lookup.blueprint) {
      log.info({ callId: input.callId, source: 'cache', confidence: lookup.blueprint.structureConfidence }, 'Resolved from cache')

      return {
        success: true,
        data: lookup.blueprint,
        stateTransitions: [
          { type: 'SET_SELECTED_CALL', callId: input.callId },
          { type: 'SET_BLUEPRINT', blueprint: lookup.blueprint },
          { type: 'SET_PHASE', phase: 'research' as const },
        ],
        checkpoint: { type: 'call_selected', payload: { callId: input.callId, source: 'cache' } },
        telemetry: { latencyMs: Date.now() - start },
      }
    }

    // Step 2: Use raw evidence from service for LLM extraction
    const chunks = lookup.rawEvidence ?? []

    // Step 3: Extract structure via LLM
    const evidenceText = chunks
      .map(c => `[${c.docType || 'doc'}] ${c.content}`)
      .join('\n\n---\n\n')

    let sections: SectionSpec[] = DEFAULT_SECTIONS
    let structureConfidence = 0.3

    if (evidenceText.trim()) {
      try {
        const { provider: resolvedProvider, model: resolvedModel } = resolveAgentModel({ task: 'structure_extraction', ctx: ctx.routingCtx })
        const response = await generate({
          provider: resolvedProvider,
          model: resolvedModel,
          system: 'Extract required application sections from EU funding call docs. Return a JSON array of objects with: id, title, description, order, generationOrder, importance ("critical"|"standard"|"supplementary"), expectedLength ("short"|"medium"|"long"), dependsOn (string[]), modelHint ("heavy"|"light"), mandatory (boolean), confidence (0-1).',
          messages: [{ role: 'user', content: `Call: ${input.callTitle || input.callId}\nProgram: ${input.program || 'Unknown'}\n\n${evidenceText}` }],
          temperature: 0.2,
          maxTokens: 20_000,
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
      sources: chunks.map(c => c.source || c.id),
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
        sourceDocs: chunks.map(c => c.source || c.id),
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

registerTool<Input, CallBlueprint>({
  name: 'resolve_call',
  category: 'decision',
  description: 'Resolve a funding call by ID — retrieves or builds its blueprint from knowledge base',
  inputSchema,
  execute,
  timeout: 90_000,
})
