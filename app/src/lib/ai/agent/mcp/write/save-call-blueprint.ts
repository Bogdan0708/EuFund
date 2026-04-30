// ── MCP Handler: save_call_blueprint ──────────────────────────────────────
// Registers the save_call_blueprint tool on the write MCP server.
// Delegates business logic to the blueprint service.
// Blueprint upsert is idempotent by callId — no stateVersion guard needed.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { saveCallBlueprint, buildCallBlueprintFromArgs } from '../../services/blueprint'
import { ValidationError, NotFoundError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'

const sectionSpecShape = z.object({
  title: z.string(),
  description: z.string(),
  evaluationWeight: z.number().optional(),
})

export const inputShape = {
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

export const inputSchema = z.object(inputShape)

export function registerSaveCallBlueprint(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'save_call_blueprint',
    'Upsert an agent-extracted call blueprint into callKnowledge. Idempotent by callId — safe to call multiple times. Returns callId, version, contentHash, and persistedAt.',
    inputShape,
    async (args) => {
      try {
        const blueprint = buildCallBlueprintFromArgs(args, ctx)
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
