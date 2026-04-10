import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { refreshCallFreshness } from '../services/freshness'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-refresh-freshness' })

const inputSchema = z.object({
  callId: z.string().min(1),
  callTitle: z.string().min(1),
  program: z.string().min(1),
})

type Input = z.infer<typeof inputSchema>

async function execute(input: Input, toolCtx: ToolContext): Promise<ToolResult> {
  const start = Date.now()

  // Build a minimal ServiceContext from ToolContext
  const ctx = {
    userId: toolCtx.userId,
    sessionId: toolCtx.sessionId,
    requestId: toolCtx.requestId,
    now: new Date(),
  }

  try {
    const result = await refreshCallFreshness(ctx, input.callId)

    log.info(
      { callId: input.callId, isOpen: result.isOpen, confidence: result.freshnessConfidence },
      'Freshness check completed',
    )

    return {
      success: true,
      data: result,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error(
      { callId: input.callId, error: error instanceof Error ? error.message : String(error) },
      'refresh_call_freshness failed',
    )
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Freshness check failed',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool({
  name: 'refresh_call_freshness',
  category: 'read',
  description: 'Check if a funding call is still open using live web search',
  inputSchema,
  execute: execute as any,
  timeout: 30_000,
})
