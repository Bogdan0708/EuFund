// ── MCP Handler: score_fit ────────────────────────────────────────────────
// Registers the score_fit tool on the rules MCP server.
// Delegates business logic to the eligibility service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { scoreFit } from '../../services/eligibility'
import type { ServiceContext } from '../../services/types'

const inputShape = {
  projectSummary: z.object({
    organization: z.object({
      orgType: z.string(),
      orgSize: z.string().optional(),
      caenPrimary: z.string().optional(),
      nutsRegion: z.string().optional(),
      employeeCount: z.number().optional(),
      annualRevenue: z.number().optional(),
    }),
    project: z.object({
      totalBudget: z.number().optional(),
      ownContrib: z.number().optional(),
      durationMonths: z.number().optional(),
    }),
  }),
  callId: z.string(),
}

export function registerScoreFit(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'score_fit',
    'Compute a multi-dimensional fit score comparing project characteristics against a specific EU funding call. Scores thematic fit (sector/org-type/region alignment), eligibility fit (rules engine), and budget fit (range alignment). Returns an overall weighted score with reasoning. No LLM calls.',
    inputShape,
    async (args) => {
      const result = await scoreFit(ctx, args.projectSummary, args.callId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    },
  )
}
