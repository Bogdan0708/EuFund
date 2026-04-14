// app/src/lib/ai/agent/tools/retrieve-session-context.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { getSessionKnowledge, getSessionKnowledgeByKind } from '@/lib/ai/knowledge/session-knowledge'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-retrieve-session-context' })

const inputSchema = z.object({
  kind: z.enum(['brief', 'evidence_map', 'risks', 'budget_rationale', 'decision_log', 'section_pattern'])
    .optional()
    .describe('Filter by knowledge page kind'),
})

type Input = z.infer<typeof inputSchema>

interface SessionContextPage {
  id: string
  kind: string
  slug: string
  title: string
  contentMd: string
  frontmatter: Record<string, unknown>
}

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<SessionContextPage[]>> {
  const start = Date.now()

  try {
    const rows = input.kind
      ? await getSessionKnowledgeByKind(ctx.sessionId, input.kind)
      : await getSessionKnowledge(ctx.sessionId)

    const pages: SessionContextPage[] = rows.map(r => ({
      id: r.id,
      kind: r.kind,
      slug: r.slug,
      title: r.title,
      contentMd: r.contentMd,
      frontmatter: r.frontmatter as Record<string, unknown>,
    }))

    log.info({ sessionId: ctx.sessionId, kind: input.kind ?? 'all', count: pages.length, latencyMs: Date.now() - start }, 'Session context retrieved')

    return {
      success: true,
      data: pages,
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'retrieve_session_context failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to retrieve session context',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool({
  name: 'retrieve_session_context',
  category: 'read',
  description: 'Retrieve session-specific knowledge pages (brief, evidence map, risks, decision log, accepted section patterns)',
  inputSchema,
  execute: execute as any,
  timeout: 10_000,
})
