import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult } from '../types'
import type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-get-call-blueprint' })

const inputSchema = z.object({
  callId: z.string().min(1).describe('The ID of the call to look up'),
})

type Input = z.infer<typeof inputSchema>

async function execute(input: Input): Promise<ToolResult<CallBlueprint | null>> {
  const start = Date.now()

  try {
    const [row] = await db.select().from(callKnowledge).where(eq(callKnowledge.callId, input.callId)).limit(1)

    if (!row) {
      log.info({ callId: input.callId }, 'No cached blueprint found')
      return {
        success: true,
        data: null,
        telemetry: { latencyMs: Date.now() - start },
      }
    }

    const norm = (row.normalized ?? {}) as Record<string, unknown>
    const requiredSections = (norm.requiredSections ?? []) as { title: string; description: string; evaluationWeight?: number }[]
    const mandatoryAnnexes = (norm.mandatoryAnnexes ?? []) as string[]
    const eligibilityCriteria = (norm.eligibilityCriteria ?? []) as string[]
    const evaluationGrid = (norm.evaluationGrid ?? []) as { criterion: string; maxPoints: number }[]
    const cofinancingRate = (norm.cofinancingRate ?? 0) as number

    const blueprint: CallBlueprint = {
      callId: row.callId,
      program: row.program,
      isOpen: true, // Will be updated by freshness check
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
      normalized: {
        requiredSections: (norm.requiredSections ?? []) as SectionSpec[],
        mandatoryAnnexes,
        eligibilityCriteria,
        evaluationGrid,
        cofinancingRate,
      },
      structureConfidence: row.structureConfidence,
    }

    log.info({ callId: input.callId, status: row.status, confidence: row.structureConfidence }, 'Blueprint loaded from cache')

    return {
      success: true,
      data: blueprint,
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error({ callId: input.callId, error: error instanceof Error ? error.message : String(error) }, 'get_call_blueprint failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read blueprint',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool<Input, CallBlueprint | null>({
  name: 'get_call_blueprint',
  category: 'read',
  description: 'Look up a cached call blueprint from the knowledge base by call ID',
  inputSchema,
  execute,
  timeout: 10_000,
})
