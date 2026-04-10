// ── MCP Handler: run_eligibility ──────────────────────────────────────────
// Registers the run_eligibility tool on the rules MCP server.
// Delegates business logic to the eligibility service — this file owns only
// the MCP envelope translation.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { runEligibility } from '../../services/eligibility'
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

export function registerRunEligibility(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'run_eligibility',
    'Run deterministic eligibility rules for a project against a specific EU funding call. Checks org type, region, CAEN, budget, co-financing rate, duration, and deadline. Returns per-rule results with bilingual messages and an overall score. No LLM calls.',
    inputShape,
    async (args) => {
      const result = await runEligibility(ctx, args.projectSummary, args.callId)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    },
  )
}
