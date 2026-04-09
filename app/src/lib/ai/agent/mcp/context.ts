// ── MCP Context Builder ──────────────────────────────────────────────────────
// Converts a verified MCP token payload into a ServiceContext,
// threading request identity through the service layer.

import type { McpTokenPayload } from './auth'
import type { ServiceContext } from '../services/types'

export function buildServiceContext(verified: McpTokenPayload, requestId: string): ServiceContext {
  return {
    userId: verified.userId,
    sessionId: verified.sessionId,
    organizationId: verified.organizationId,
    projectId: verified.projectId,
    requestId,
    now: new Date(),
  }
}
