import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { generate } from '@/lib/ai/providers/router'
import { parseAIJson } from '../utils'
import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-refresh-freshness' })

const inputSchema = z.object({
  callId: z.string().min(1),
  callTitle: z.string().min(1),
  program: z.string().min(1),
})

type Input = z.infer<typeof inputSchema>

interface FreshnessResult {
  isOpen: boolean
  amendments: string[]
  warnings: string[]
  freshnessConfidence: number
  checkedAt: string
}

async function execute(input: Input, _ctx: ToolContext): Promise<ToolResult<FreshnessResult>> {
  const start = Date.now()

  try {
    const response = await generate({
      provider: 'perplexity',
      model: 'sonar',
      system: 'You verify EU funding call status. Check official Romanian sources (mfe.gov.ro, fonduri-ue.ro, MySMIS). Return JSON: { "isOpen": boolean, "amendments": string[], "warnings": string[], "confidence": number }',
      messages: [{
        role: 'user',
        content: `Is the following EU funding call still open for submissions? Check for recent amendments or deadline changes.\n\nCall: ${input.callTitle}\nProgram: ${input.program}\nCall ID: ${input.callId}`,
      }],
      temperature: 0.1,
      maxTokens: 2000,
    })

    let parsed: { isOpen: boolean; amendments: string[]; warnings: string[]; confidence?: number }
    try {
      parsed = parseAIJson(response.content)
    } catch {
      parsed = { isOpen: true, amendments: [], warnings: ['Could not parse freshness response'] }
    }

    const freshnessConfidence = parsed.confidence ?? 0.5
    const checkedAt = new Date().toISOString()

    // Update call_knowledge
    try {
      await db.update(callKnowledge)
        .set({ freshnessCheckedAt: new Date(), freshnessConfidence, updatedAt: new Date() })
        .where(eq(callKnowledge.callId, input.callId))
    } catch (dbErr) {
      log.warn({ error: dbErr instanceof Error ? dbErr.message : String(dbErr) }, 'Failed to update freshness in DB')
    }

    const result: FreshnessResult = {
      isOpen: parsed.isOpen,
      amendments: parsed.amendments || [],
      warnings: parsed.warnings || [],
      freshnessConfidence,
      checkedAt,
    }

    log.info({ callId: input.callId, isOpen: result.isOpen, confidence: freshnessConfidence }, 'Freshness check completed')

    return {
      success: true,
      data: result,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
      telemetry: {
        latencyMs: Date.now() - start,
        tokensUsed: response.tokensUsed,
        model: response.model,
        provider: response.provider,
      },
    }
  } catch (error) {
    log.error({ callId: input.callId, error: error instanceof Error ? error.message : String(error) }, 'refresh_call_freshness failed')
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
