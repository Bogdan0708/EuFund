import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { getVectorStore, type SearchResult } from '@/lib/vectors/store'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-search-calls' })

const inputSchema = z.object({
  query: z.string().min(3).describe('Search query describing the project or funding need'),
  program: z.string().optional().describe('Filter by program (e.g. PNRR, PEO, POTJ)'),
  maxResults: z.number().min(1).max(20).default(5),
})

type Input = z.infer<typeof inputSchema>

interface CallMatch {
  callId: string
  title: string
  program: string
  score: number
  snippet: string
  sourceUrl?: string
}

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<CallMatch[]>> {
  const start = Date.now()

  try {
    const store = getVectorStore()
    const filter: Record<string, unknown> = {}
    if (input.program) {
      filter.program = input.program
    }

    const results: SearchResult[] = await store.search(
      input.query,
      input.maxResults * 2,
      Object.keys(filter).length > 0 ? filter : undefined,
    )

    // Deduplicate by callId (multiple chunks from same call)
    const seen = new Set<string>()
    const matches: CallMatch[] = []
    for (const r of results) {
      const callId =
        (r.metadata.callId as string) ||
        (r.metadata.sourceId as string) ||
        r.id
      if (seen.has(callId)) continue
      seen.add(callId)
      matches.push({
        callId,
        title:
          (r.metadata.callTitle as string) ||
          (r.metadata.title as string) ||
          callId,
        program: (r.metadata.program as string) || 'unknown',
        score: Math.round(r.score * 100) / 100,
        snippet: r.content.slice(0, 200),
        sourceUrl: r.metadata.sourceUrl as string | undefined,
      })
      if (matches.length >= input.maxResults) break
    }

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

registerTool({
  name: 'search_calls',
  category: 'read',
  description:
    'Search for matching EU funding calls based on project description, sector, or keywords',
  inputSchema,
  execute: execute as any,
  timeout: 15_000,
})
