// app/src/lib/ai/agent/tools/list-missing-annexes.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { checkMissingAnnexes } from '../services/application'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-list-annexes' })

const inputSchema = z.object({})

interface AnnexStatus {
  name: string
  status: 'missing' | 'mentioned'
}

async function execute(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult<AnnexStatus[]>> {
  const start = Date.now()

  try {
    const serviceCtx = {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      requestId: ctx.requestId,
      now: new Date(),
    }

    const { required, uploaded, missing } = await checkMissingAnnexes(serviceCtx, ctx.sessionId)

    const statuses: AnnexStatus[] = required.map(name => ({
      name,
      status: uploaded.includes(name) ? 'mentioned' as const : 'missing' as const,
    }))

    const missingCount = missing.length

    log.info({ total: required.length, missing: missingCount }, 'Annex check completed')

    return {
      success: true,
      data: statuses,
      warnings: missingCount > 0 ? [`${missingCount} mandatory annexes not yet referenced in sections`] : undefined,
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'list_missing_annexes failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Annex check failed',
      retryable: false,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool<Record<string, never>, AnnexStatus[]>({
  name: 'list_missing_annexes',
  category: 'read',
  description: 'Check which mandatory annexes are missing or not referenced',
  inputSchema,
  execute,
  timeout: 5_000,
})
