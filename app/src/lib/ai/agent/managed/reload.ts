// app/src/lib/ai/agent/managed/reload.ts
//
// Post-write reload helper for the managed runtime.
//
// Loads agent_sessions + agent_sections by id, scoped to userId, and maps
// rows into the in-memory AgentSession / AgentSection shapes the runtime
// already uses. Returns null when the session row is missing or owned by
// another user — the caller treats that as a reload failure.
//
// Row-mapping functions are intentionally duplicated from
// app/src/app/api/ai/agent/route.ts (mapSessionRow at line 571, mapSectionRow
// at line 593). The spec for PR1 rules out extracting a shared mapper module
// to keep blast radius small. A post-pilot cleanup PR can unify them.

import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { AgentSession, AgentSection } from '../types'

export interface ReloadResult {
  session: AgentSession
  sections: AgentSection[]
}

export async function reloadSessionAndSections(
  sessionId: string,
  userId: string,
): Promise<ReloadResult | null> {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
    .limit(1)

  if (!row) return null

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  return {
    session: mapSessionRow(row),
    sections: sectionRows.map(mapSectionRow),
  }
}

function mapSessionRow(row: Record<string, unknown>): AgentSession {
  return {
    id: row.id as string,
    userId: row.userId as string,
    projectId: (row.projectId as string) ?? null,
    status: row.status as AgentSession['status'],
    locale: row.locale as 'ro' | 'en',
    selectedCallId: row.selectedCallId as string | null,
    currentPhase: row.currentPhase as AgentSession['currentPhase'],
    blueprint: row.blueprint as AgentSession['blueprint'],
    eligibility: row.eligibility as AgentSession['eligibility'],
    outline: row.outline as AgentSession['outline'],
    warnings: (row.warnings as AgentSession['warnings']) || [],
    planningArtifact: row.planningArtifact as AgentSession['planningArtifact'],
    outlineFrozen: (row.outlineFrozen as boolean) || false,
    messageSummary: row.messageSummary as string | null,
    stateVersion: row.stateVersion as number,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }
}

function mapSectionRow(row: Record<string, unknown>): AgentSection {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string,
    sectionKey: row.sectionKey as string,
    title: row.title as string,
    documentOrder: row.documentOrder as number,
    generationOrder: row.generationOrder as number,
    status: row.status as AgentSection['status'],
    content: row.content as string | null,
    acceptedContent: row.acceptedContent as string | null,
    modelUsed: row.modelUsed as string | null,
    retryCount: row.retryCount as number,
    sourcesUsed: row.sourcesUsed as string[] | null,
    promptVersion: row.promptVersion as string | null,
    latencyMs: row.latencyMs as number | null,
    tokenUsage: row.tokenUsage as AgentSection['tokenUsage'],
    errorClass: row.errorClass as string | null,
    rejectionReason: row.rejectionReason as string | null,
    updatedAt: row.updatedAt as Date,
  }
}
