// ── changeCall service ──────────────────────────────────────────────────────
// Resets a session to a new call in a single logical operation. Single
// CAS-protected UPDATE, single stateVersion bump, single audit entry.
// Distinct from setSelectedCall (which is used by preselect override
// paths and keeps its narrow scope of just selecting a call).

import { and, eq } from 'drizzle-orm'
import { db, withUserRLS } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { logAudit } from '@/lib/legal/audit'
import { logger } from '@/lib/logger'
import { metrics } from '@/lib/monitoring/metrics'
import { ConcurrencyError, ValidationError, NotFoundError } from './errors'
import { lookupBlueprint, outlineFromBlueprint } from './blueprint'
import { searchCalls } from './evidence'
import type { ServiceContext } from './types'
import type { AgentSession, CallBlueprint, SectionSpec } from '../types'

const log = logger.child({ component: 'change-call-service' })

function bucketizeSectionsDiscarded(n: number): string {
  if (n === 0) return '0'
  if (n <= 3) return '1-3'
  if (n <= 10) return '4-10'
  return '10+'
}

export interface ChangeCallInput {
  sessionId: string
  newCallId: string
  expectedStateVersion: number
}

export interface ChangeCallResult {
  session: AgentSession
  sectionsDiscarded: number
  blueprintSource: 'cached' | 'none'
}

async function callExists(ctx: ServiceContext, callId: string): Promise<boolean> {
  // Three-prong existence probe, mirroring preselect confirm-mode.
  const probes = ['callId', 'sourceId', 'callCode'] as const
  for (const key of probes) {
    const { matches } = await searchCalls(ctx, callId, { [key]: callId, maxResults: 1 } as never)
    if (matches.some((m) => m.callId === callId)) return true
  }
  // Fallback: description-based search (the picker's own behaviour).
  const { matches } = await searchCalls(ctx, callId, { maxResults: 5 })
  return matches.some((m) => m.callId === callId)
}

export async function changeCall(
  ctx: ServiceContext,
  input: ChangeCallInput,
): Promise<ChangeCallResult> {
  return withUserRLS(ctx.userId, async () => {
    const [session] = await db
      .select()
      .from(agentSessions)
      .where(and(eq(agentSessions.id, input.sessionId), eq(agentSessions.userId, ctx.userId)))
      .limit(1)

    if (!session) throw new NotFoundError('agent_session', input.sessionId)

    if (session.stateVersion !== input.expectedStateVersion) {
      throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion as number)
    }

    if (session.outlineFrozen) {
      throw new ValidationError(
        'outlineFrozen',
        'Cannot change call while outline is frozen',
        'POLICY_OUTLINE_ALREADY_FROZEN',
      )
    }

    if (session.selectedCallId === input.newCallId) {
      throw new ValidationError(
        'newCallId',
        'New call is identical to current call',
        'VALIDATION_NO_OP',
      )
    }

    const exists = await callExists(ctx, input.newCallId)
    if (!exists) {
      throw new ValidationError(
        'newCallId',
        `Unknown callId '${input.newCallId}'`,
        'INVALID_CALL_ID',
      )
    }

    // Best-effort blueprint lookup.
    let blueprint: CallBlueprint | null = null
    let blueprintSource: 'cached' | 'none' = 'none'
    try {
      const lookup = await lookupBlueprint(ctx, input.newCallId)
      if (lookup.cached) {
        blueprint = lookup.blueprint
        blueprintSource = 'cached'
      }
    } catch (err) {
      log.warn(
        { err, callId: input.newCallId },
        'blueprint_lookup_failed_during_change_call',
      )
    }

    const newOutline: SectionSpec[] | null = blueprint ? outlineFromBlueprint(blueprint) : null
    const newPhase = blueprint ? 'structuring' : 'research'

    // Count sections to be discarded for telemetry/audit.
    const existingSections = await db
      .select()
      .from(agentSections)
      .where(eq(agentSections.sessionId, input.sessionId))
    const sectionsDiscarded = existingSections.length

    await db.delete(agentSections).where(eq(agentSections.sessionId, input.sessionId))

    const newStateVersion = (session.stateVersion as number) + 1
    const casResult = await db
      .update(agentSessions)
      .set({
        selectedCallId: input.newCallId,
        blueprint: blueprint as never,
        outline: newOutline as never,
        eligibility: null,
        warnings: [],
        currentPhase: newPhase,
        outlineFrozen: false,
        stateVersion: newStateVersion,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentSessions.id, input.sessionId),
          eq(agentSessions.stateVersion, input.expectedStateVersion),
        ),
      )
      .returning({ id: agentSessions.id })

    if (casResult.length === 0) {
      // Another writer committed between our pre-read and this UPDATE.
      const [current] = await db
        .select({ stateVersion: agentSessions.stateVersion })
        .from(agentSessions)
        .where(eq(agentSessions.id, input.sessionId))
        .limit(1)
      throw new ConcurrencyError(input.expectedStateVersion, current?.stateVersion ?? -1)
    }

    const [updated] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, input.sessionId))
      .limit(1)

    metrics.inc('change_call_total', {
      from_blueprint: session.blueprint ? 'yes' : 'no',
      to_blueprint: blueprintSource === 'cached' ? 'yes' : 'no',
      sections_discarded_bucket: bucketizeSectionsDiscarded(sectionsDiscarded),
    })

    await logAudit({
      userId: ctx.userId,
      action: 'session.call_changed',
      resourceType: 'agent_session',
      resourceId: input.sessionId,
      metadata: {
        previousCallId: session.selectedCallId,
        newCallId: input.newCallId,
        sectionsDiscarded,
        blueprintSource,
        requestId: ctx.requestId,
      },
    })

    return {
      session: updated as AgentSession,
      sectionsDiscarded,
      blueprintSource,
    }
  })
}
