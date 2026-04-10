// ── MCP Handler: save_call_blueprint ──────────────────────────────────────
// Registers the save_call_blueprint tool on the write MCP server.
// Delegates business logic to the blueprint service.
// Blueprint upsert is idempotent by callId — no stateVersion guard needed.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { saveCallBlueprint } from '../../services/blueprint'
import { ValidationError, NotFoundError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'

const sectionSpecShape = z.object({
  title: z.string(),
  description: z.string(),
  evaluationWeight: z.number().optional(),
})

const inputShape = {
  callId: z.string().min(1),
  blueprint: z.object({
    callId: z.string().optional(),
    program: z.string().optional(),
    requiredSections: z.array(sectionSpecShape).optional(),
    mandatoryAnnexes: z.array(z.string()).optional(),
    eligibilityCriteria: z.array(z.string()).optional(),
    structureConfidence: z.number().optional(),
    sources: z.array(z.string()).optional(),
  }),
}

export function registerSaveCallBlueprint(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'save_call_blueprint',
    'Upsert an agent-extracted call blueprint into callKnowledge. Idempotent by callId — safe to call multiple times. Returns callId, version, contentHash, and persistedAt.',
    inputShape,
    async (args) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const blueprint: any = {
          ...args.blueprint,
          callId: args.callId,
          isOpen: true,
          amendments: [],
          warnings: [],
          requiredSections: args.blueprint.requiredSections ?? [],
          mandatoryAnnexes: args.blueprint.mandatoryAnnexes ?? [],
          eligibilityCriteria: args.blueprint.eligibilityCriteria ?? [],
          evaluationGrid: [],
          cofinancingRate: 0,
          eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
          sources: args.blueprint.sources ?? [],
          verifiedAt: ctx.now.toISOString(),
          raw: { notebookLmResponse: '', perplexityResponse: '', retrievedAt: ctx.now.toISOString() },
          normalized: { requiredSections: args.blueprint.requiredSections ?? [], mandatoryAnnexes: args.blueprint.mandatoryAnnexes ?? [], eligibilityCriteria: args.blueprint.eligibilityCriteria ?? [], evaluationGrid: [], cofinancingRate: 0 },
          structureConfidence: args.blueprint.structureConfidence ?? 0.3,
        }

        const result = await saveCallBlueprint(ctx, args.callId, blueprint)
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }
      } catch (err) {
        if (err instanceof ValidationError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'VALIDATION', field: err.field }) }],
            isError: true,
          }
        }
        if (err instanceof NotFoundError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'NOT_FOUND' }) }],
            isError: true,
          }
        }
        throw err
      }
    },
  )
}
