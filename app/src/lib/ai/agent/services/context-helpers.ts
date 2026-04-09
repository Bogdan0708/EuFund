import type { ToolContext } from '../types'
import type { ServiceContext } from './types'

export function buildServiceContextFromToolCtx(toolCtx: ToolContext): ServiceContext {
  return {
    userId: toolCtx.userId,
    sessionId: toolCtx.sessionId,
    organizationId: (toolCtx.session as any).organizationId ?? undefined,
    projectId: toolCtx.session.projectId ?? undefined,
    requestId: toolCtx.requestId,
    now: new Date(),
  }
}
