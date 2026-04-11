// app/src/lib/ai/agent/tools/retrieve-call-evidence.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import type { EvidenceChunk } from '../services/types'
import { retrieveEvidence } from '../services/evidence'
import { buildServiceContextFromToolCtx } from '../services/context-helpers'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-retrieve-evidence' })

const inputSchema = z.object({
  callId: z.string().min(1),
  query: z.string().optional().describe('Additional search query to focus evidence retrieval'),
  maxChunks: z.number().min(1).max(50).default(15),
})

type Input = z.infer<typeof inputSchema>

async function execute(input: Input, toolCtx: ToolContext): Promise<ToolResult<EvidenceChunk[]>> {
  const start = Date.now()

  try {
    const ctx = buildServiceContextFromToolCtx(toolCtx)
    const bundle = await retrieveEvidence(ctx, input.callId, {
      query: input.query,
      maxChunks: input.maxChunks,
    })

    log.info(
      { callId: input.callId, totalChunks: bundle.totalChunks, returned: bundle.chunks.length, latencyMs: Date.now() - start },
      'retrieve_call_evidence completed',
    )

    return {
      success: true,
      data: bundle.chunks,
      telemetry: { latencyMs: Date.now() - start, sources: bundle.chunks.map(e => e.source) },
    }
  } catch (error) {
    log.error(
      { callId: input.callId, error: error instanceof Error ? error.message : String(error) },
      'retrieve_call_evidence failed',
    )
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Evidence retrieval failed',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool<Input, EvidenceChunk[]>({
  name: 'retrieve_call_evidence',
  category: 'read',
  description: 'Retrieve evidence chunks for a specific funding call from the knowledge base',
  inputSchema,
  execute,
  timeout: 20_000,
})
