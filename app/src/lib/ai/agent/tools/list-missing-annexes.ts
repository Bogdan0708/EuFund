// app/src/lib/ai/agent/tools/list-missing-annexes.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-list-annexes' })

const inputSchema = z.object({})

interface AnnexStatus {
  name: string
  status: 'missing' | 'mentioned'
}

async function execute(_input: unknown, ctx: ToolContext): Promise<ToolResult<AnnexStatus[]>> {
  const start = Date.now()

  const blueprint = ctx.session.blueprint
  if (!blueprint) {
    return {
      success: true,
      data: [],
      warnings: ['No blueprint available — cannot check annexes'],
      telemetry: { latencyMs: Date.now() - start },
    }
  }

  const mandatoryAnnexes = (blueprint as any).mandatoryAnnexes as string[] || []

  // Check if any section content mentions each annex
  const sectionContent = ctx.sections
    .filter(s => s.content || s.acceptedContent)
    .map(s => (s.acceptedContent || s.content || '').toLowerCase())
    .join(' ')

  const statuses: AnnexStatus[] = mandatoryAnnexes.map(annex => ({
    name: annex,
    status: sectionContent.includes(annex.toLowerCase()) ? 'mentioned' as const : 'missing' as const,
  }))

  const missingCount = statuses.filter(s => s.status === 'missing').length

  log.info({ total: mandatoryAnnexes.length, missing: missingCount }, 'Annex check completed')

  return {
    success: true,
    data: statuses,
    warnings: missingCount > 0 ? [`${missingCount} mandatory annexes not yet referenced in sections`] : undefined,
    telemetry: { latencyMs: Date.now() - start },
  }
}

registerTool({
  name: 'list_missing_annexes',
  category: 'read',
  description: 'Check which mandatory annexes are missing or not referenced',
  inputSchema,
  execute: execute as any,
  timeout: 5_000,
})
