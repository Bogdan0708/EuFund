// app/src/lib/ai/agent/tools/retrieve-call-evidence.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { getVectorStore, type SearchResult } from '@/lib/vectors/store'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-retrieve-evidence' })

const inputSchema = z.object({
  callId: z.string().min(1),
  query: z.string().optional().describe('Additional search query to focus evidence retrieval'),
  maxChunks: z.number().min(1).max(50).default(15),
})

type Input = z.infer<typeof inputSchema>

// Document type priority for ranking
const DOC_TYPE_PRIORITY: Record<string, number> = {
  ghid: 1,      // Guide - most authoritative
  anexa: 2,     // Annex
  cerere: 3,    // Application form
  legislation: 4,
  summary: 5,
}

interface EvidenceChunk {
  id: string
  content: string
  docType: string
  source: string
  score: number
  priority: number
}

async function execute(input: Input, _ctx: ToolContext): Promise<ToolResult<EvidenceChunk[]>> {
  const start = Date.now()

  try {
    const store = getVectorStore()
    const searchQuery = input.query
      ? `${input.callId} ${input.query}`
      : input.callId

    const results: SearchResult[] = await store.search(searchQuery, input.maxChunks * 2, { callId: input.callId })

    // If filtered search returns nothing, try broader search
    let chunks = results
    if (chunks.length === 0) {
      chunks = await store.search(searchQuery, input.maxChunks * 2)
    }

    // Map and rank by document type
    const evidence: EvidenceChunk[] = chunks.map(r => {
      const docType = (r.metadata.documentType as string) || (r.metadata.docType as string) || 'unknown'
      return {
        id: r.id,
        content: r.content,
        docType,
        source: (r.metadata.source as string) || (r.metadata.sourceUrl as string) || 'unknown',
        score: r.score,
        priority: DOC_TYPE_PRIORITY[docType] ?? 10,
      }
    })

    // Sort by priority (lower = better), then by score
    evidence.sort((a, b) => a.priority - b.priority || b.score - a.score)

    const trimmed = evidence.slice(0, input.maxChunks)

    log.info({ callId: input.callId, totalChunks: chunks.length, returned: trimmed.length, latencyMs: Date.now() - start }, 'Evidence retrieved')

    return {
      success: true,
      data: trimmed,
      telemetry: { latencyMs: Date.now() - start, sources: trimmed.map(e => e.source) },
    }
  } catch (error) {
    log.error({ callId: input.callId, error: error instanceof Error ? error.message : String(error) }, 'retrieve_call_evidence failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Evidence retrieval failed',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool({
  name: 'retrieve_call_evidence',
  category: 'read',
  description: 'Retrieve evidence chunks for a specific funding call from the knowledge base',
  inputSchema,
  execute: execute as any,
  timeout: 20_000,
})
