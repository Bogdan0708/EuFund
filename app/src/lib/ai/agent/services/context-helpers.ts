import type { ToolContext } from '../types'
import type { ServiceContext } from './types'

type SessionWithOrganization = ToolContext['session'] & { organizationId?: string | null }

export function buildServiceContextFromToolCtx(toolCtx: ToolContext): ServiceContext {
  const session = toolCtx.session as SessionWithOrganization

  return {
    userId: toolCtx.userId,
    sessionId: toolCtx.sessionId,
    organizationId: session.organizationId ?? undefined,
    projectId: toolCtx.session.projectId ?? undefined,
    requestId: toolCtx.requestId,
    now: new Date(),
  }
}
