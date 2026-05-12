import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult } from '../types'
import type { CallBlueprint } from '@/lib/ai/agent/types'
import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import { buildBlueprintFromCache } from '@/lib/ai/agent/services/blueprint'

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

    // Single hydration path shared with lookupBlueprint — materializes
    // partial cached section rows into full SectionSpec[] and passes
    // through rows that already carry the full shape.
    const norm = (row.normalized ?? {}) as Record<string, unknown>
    const blueprint = buildBlueprintFromCache(row, norm)

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
