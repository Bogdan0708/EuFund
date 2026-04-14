import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import type { CallMatch } from '../services/types'
import { searchCalls } from '../services/evidence'
import { buildServiceContextFromToolCtx } from '../services/context-helpers'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-search-calls' })

const inputSchema = z.object({
  query: z.string().min(3).describe('Search query describing the project or funding need'),
  program: z.string().optional().describe('Filter by program (e.g. PNRR, PEO, POTJ)'),
  maxResults: z.number().min(1).max(20).default(5),
})

type Input = z.infer<typeof inputSchema>

async function execute(input: Input, toolCtx: ToolContext): Promise<ToolResult<CallMatch[]>> {
  const start = Date.now()

  try {
    const ctx = buildServiceContextFromToolCtx(toolCtx)
    const { matches } = await searchCalls(ctx, input.query, {
      program: input.program,
      maxResults: input.maxResults,
    })

    log.info(
      { query: input.query, results: matches.length, latencyMs: Date.now() - start },
      'search_calls completed',
    )

    return {
      success: true,
      data: matches,
      stateTransitions:
        matches.length > 0 ? [{ type: 'SET_PHASE', phase: 'research' as const }] : undefined,
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      'search_calls failed',
    )
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Search failed',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool<Input, CallMatch[]>({
  name: 'search_calls',
  category: 'read',
  description:
    'Search for matching EU funding calls based on project description, sector, or keywords',
  inputSchema,
  execute,
  timeout: 15_000,
})
