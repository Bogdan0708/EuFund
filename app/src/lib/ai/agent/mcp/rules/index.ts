// ── Rules MCP Server ──────────────────────────────────────────────────────
// Creates the eufunds-rules MCP server and registers all 5 deterministic
// tools. No LLM calls — all evaluation is rules-based.

import { createMcpDomain } from '../server'
import type { ServiceContext } from '../../services/types'
import { registerRunEligibility } from './run-eligibility'
import { registerValidateSection } from './validate-section'
import { registerValidateApplication } from './validate-application'
import { registerCheckMissingAnnexes } from './check-missing-annexes'
import { registerScoreFit } from './score-fit'

export function createRulesServer(ctx: ServiceContext) {
  const server = createMcpDomain('eufunds-rules', '1.0.0')
  registerRunEligibility(server, ctx)
  registerValidateSection(server, ctx)
  registerValidateApplication(server, ctx)
  registerCheckMissingAnnexes(server, ctx)
  registerScoreFit(server, ctx)
  return server
}
