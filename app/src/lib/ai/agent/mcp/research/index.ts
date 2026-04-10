// ── Research MCP Server ────────────────────────────────────────────────────
// Creates the eufunds-research MCP server and registers 3 tools.
// These tools make external network calls — results may be slow and stale.

import { createMcpDomain } from '../server'
import type { ServiceContext } from '../../services/types'
import { registerRefreshCallFreshness } from './refresh-call-freshness'
import { registerVerifyDeadline } from './verify-deadline'
import { registerCheckCallPageUpdates } from './check-call-page-updates'

export function createResearchServer(ctx: ServiceContext) {
  const server = createMcpDomain('eufunds-research', '1.0.0')
  registerRefreshCallFreshness(server, ctx)
  registerVerifyDeadline(server, ctx)
  registerCheckCallPageUpdates(server, ctx)
  return server
}
