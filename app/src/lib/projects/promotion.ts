// app/src/lib/projects/promotion.ts
//
// Session-to-project promotion. See spec:
//   docs/superpowers/specs/2026-05-02-session-to-project-promotion-design.md
//
// A projects row is the canonical project shell. An agent_session is an AI
// drafting workspace attached to that project via agent_sessions.project_id.
// This module owns the lifecycle transition that links the two.

import { and, eq } from 'drizzle-orm';
import { withUserRLS } from '@/lib/db';
import { agentSessions, projects, users, callsForProposals, callKnowledge, discoveredCalls } from '@/lib/db/schema';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { trackProjectPromotion } from '@/lib/monitoring/metrics';
import { resolveProjectOrgIdInTx } from '@/lib/projects/org-resolver';
import { UUID_RE } from '@/lib/validators/patterns';
import type { Database } from '@/lib/db';
import type { ServiceContext } from '@/lib/ai/agent/services/types';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const log = logger.child({ component: 'project-promotion' });

export type CallResolution = 'id' | 'callCode' | 'externalId' | 'discoveredContentHash' | 'callKnowledge' | 'unresolved';
export type TitleSource = 'description' | 'messageSummary' | 'callTitle' | 'fallback';

export type PromotionResult =
  | {
      promoted: true;
      projectId: string;
      created: true;
      titleSource: TitleSource;
      selectedCallResolution: CallResolution;
    }
  | { promoted: true; projectId: string; created: false; synced: boolean; resyncUnresolved?: boolean }
  | { promoted: false; reason: 'NO_SELECTED_CALL' | 'USER_NOT_FOUND' | 'SESSION_NOT_FOUND' };

export interface EnsureOpts {
  dryRun?: boolean;
}

/**
 * Sentinel for dry-run rollback. Thrown inside the withUserRLS callback to
 * roll back the transaction while carrying the would-be result through the
 * outer catch.
 */
export class DryRunRollback<T> extends Error {
  constructor(public readonly carried: T) {
    super('dry-run rollback');
    this.name = 'DryRunRollback';
  }
}

// Local threshold — kept local on purpose to avoid importing from
// preselect.ts, which itself will import this module in Task 10.
// The value happens to match preselect's MIN_DESCRIPTION_LENGTH (40),
// but the constraints are conceptually independent: preselect uses it
// to gate the ranker; we use it to decide whether a description is
// substantive enough to be a project title.
const MIN_DESCRIPTION_LEN_FOR_TITLE = 40;
const TITLE_MAX_LEN = 120;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

/** Minimal shape used by the title derivation; kept narrow on purpose. */
export interface SessionForTitle {
  selectedCallId: string;
  messageSummary: string | null;
  planningArtifact: {
    preselect?: {
      description?: string;
      candidates?: Array<{ callId?: unknown; title?: unknown }>;
    };
  } | null;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

function isCompactedToolSummary(s: string): boolean {
  const normalized = normalizeWhitespace(s).toLowerCase();
  return normalized.startsWith('conversation history summary') || normalized.includes('[tool:');
}

function cleanCallTitleCandidate(value: unknown, selectedCallId: string): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeWhitespace(value);
  if (normalized.length === 0) return null;
  if (normalized === selectedCallId) return null;
  if (SHA256_HEX_RE.test(normalized)) return null;
  return truncate(normalized, TITLE_MAX_LEN);
}

function selectedCandidateTitle(session: SessionForTitle): string | null {
  const candidates = session.planningArtifact?.preselect?.candidates;
  if (!Array.isArray(candidates)) return null;

  const match = candidates.find((candidate) => candidate.callId === session.selectedCallId);
  return cleanCallTitleCandidate(match?.title, session.selectedCallId);
}

function deriveTitleInput(
  session: {
    selectedCallId: string;
    messageSummary: string | null;
    planningArtifact: unknown;
  },
): SessionForTitle {
  return {
    selectedCallId: session.selectedCallId,
    messageSummary: session.messageSummary,
    planningArtifact: session.planningArtifact as SessionForTitle['planningArtifact'],
  };
}

export function deriveProjectTitle(
  session: SessionForTitle,
  locale: 'ro' | 'en',
  callTitleHint?: string | null,
): { title: string; source: TitleSource } {
  const desc = session.planningArtifact?.preselect?.description;
  if (typeof desc === 'string') {
    const normalized = normalizeWhitespace(desc);
    if (normalized.length >= MIN_DESCRIPTION_LEN_FOR_TITLE) {
      return { title: truncate(normalized, TITLE_MAX_LEN), source: 'description' };
    }
  }

  const summary = session.messageSummary;
  if (typeof summary === 'string' && summary.trim().length > 0) {
    const normalized = normalizeWhitespace(summary);
    if (!isCompactedToolSummary(normalized)) {
      return { title: truncate(normalized, TITLE_MAX_LEN), source: 'messageSummary' };
    }
  }

  const callTitle = cleanCallTitleCandidate(callTitleHint, session.selectedCallId)
    ?? selectedCandidateTitle(session);
  if (callTitle) {
    return { title: callTitle, source: 'callTitle' };
  }

  const idFragment = session.selectedCallId.slice(0, 12);
  const title = locale === 'en'
    ? `Untitled project — ${idFragment}`
    : `Proiect nou — ${idFragment}`;
  return { title, source: 'fallback' };
}

export interface ResolveCallResult {
  id: string | null;
  title: string | null;
  resolution: CallResolution;
}

async function resolveDirectCallForId(
  tx: DbTransaction,
  rawSelectedCallId: string,
): Promise<ResolveCallResult> {
  if (UUID_RE.test(rawSelectedCallId)) {
    const rows = await tx
      .select({ id: callsForProposals.id, titleRo: callsForProposals.titleRo })
      .from(callsForProposals)
      .where(eq(callsForProposals.id, rawSelectedCallId))
      .limit(1);
    if (rows.length === 1) {
      return { id: rows[0].id, title: rows[0].titleRo, resolution: 'id' };
    }
  }

  const codeRows = await tx
    .select({ id: callsForProposals.id, titleRo: callsForProposals.titleRo })
    .from(callsForProposals)
    .where(eq(callsForProposals.callCode, rawSelectedCallId))
    .limit(1);
  if (codeRows.length === 1) {
    return { id: codeRows[0].id, title: codeRows[0].titleRo, resolution: 'callCode' };
  }

  const extRows = await tx
    .select({ id: callsForProposals.id, titleRo: callsForProposals.titleRo })
    .from(callsForProposals)
    .where(eq(callsForProposals.externalId, rawSelectedCallId))
    .limit(2);
  if (extRows.length === 1) {
    return { id: extRows[0].id, title: extRows[0].titleRo, resolution: 'externalId' };
  }

  return { id: null, title: null, resolution: 'unresolved' };
}

const KNOWLEDGE_ALIAS_KEYS = [
  'callsForProposalsId',
  'calls_for_proposals_id',
  'canonicalCallId',
  'canonical_call_id',
  'callUuid',
  'call_uuid',
  'callCode',
  'call_code',
  'externalId',
  'external_id',
] as const;

function callKnowledgeAliases(normalized: unknown, rawSelectedCallId: string): string[] {
  if (!normalized || typeof normalized !== 'object') return [];

  const aliases: string[] = [];
  const record = normalized as Record<string, unknown>;
  for (const key of KNOWLEDGE_ALIAS_KEYS) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const normalizedValue = normalizeWhitespace(value);
    if (normalizedValue.length === 0 || normalizedValue === rawSelectedCallId) continue;
    aliases.push(normalizedValue);
  }

  return [...new Set(aliases)];
}

/**
 * Direct probe against calls_for_proposals, then DB-owned alias fallbacks.
 *
 * Direct probes:
 *   1. id (only if input matches UUID_RE)
 *   2. call_code (globally unique per schema.ts:300)
 *   3. external_id (NOT globally unique — uniqueness is per source_connector_id;
 *      LIMIT 2 + exact-one check; multi-match → unresolved to avoid linking the
 *      wrong FK)
 *
 * Alias probes cover selectedCallId values that originated from the RAG layer:
 *   - discovered_calls.content_hash when it has already been reviewed/imported
 *   - call_knowledge.call_id when it carries canonical call metadata
 */
export async function resolveCallForId(
  tx: DbTransaction,
  rawSelectedCallId: string,
): Promise<ResolveCallResult> {
  const direct = await resolveDirectCallForId(tx, rawSelectedCallId);
  if (direct.id !== null) return direct;

  // Pending / stale discovered_calls rows can carry a non-null title while
  // their callId is still null (pre-import state). Stash that title as a
  // last-resort fallback hint but DO NOT short-circuit — the call_knowledge
  // branch below may still hold the canonical FK that lets us finish
  // self-healing.
  let discoveredTitleHint: string | null = null;

  if (SHA256_HEX_RE.test(rawSelectedCallId)) {
    const discoveredRows = await tx
      .select({ callId: discoveredCalls.callId, title: discoveredCalls.title })
      .from(discoveredCalls)
      .where(eq(discoveredCalls.contentHash, rawSelectedCallId))
      .limit(1);
    if (discoveredRows[0]?.callId) {
      const resolved = await resolveDirectCallForId(tx, discoveredRows[0].callId);
      if (resolved.id !== null) {
        return { ...resolved, resolution: 'discoveredContentHash' };
      }
    }
    if (discoveredRows[0]?.title) {
      discoveredTitleHint = discoveredRows[0].title;
    }
  }

  const knowledgeRows = await tx
    .select({
      canonicalCallId: callKnowledge.canonicalCallId,
      callTitle: callKnowledge.callTitle,
      normalized: callKnowledge.normalized,
    })
    .from(callKnowledge)
    .where(eq(callKnowledge.callId, rawSelectedCallId))
    .limit(1);
  const knowledge = knowledgeRows[0];
  if (knowledge) {
    // canonical_call_id is the authoritative FK to calls_for_proposals.id
    // written by the M1 backfill. Try it before alias-key archaeology in
    // `normalized` — that path is the fallback for un-backfilled legacy rows
    // whose `normalized` payload happens to carry a callCode / externalId.
    if (knowledge.canonicalCallId) {
      const resolved = await resolveDirectCallForId(tx, knowledge.canonicalCallId);
      if (resolved.id !== null) {
        return { ...resolved, resolution: 'callKnowledge' };
      }
    }
    for (const alias of callKnowledgeAliases(knowledge.normalized, rawSelectedCallId)) {
      const resolved = await resolveDirectCallForId(tx, alias);
      if (resolved.id !== null) {
        return { ...resolved, resolution: 'callKnowledge' };
      }
    }
    const title = cleanCallTitleCandidate(knowledge.callTitle, rawSelectedCallId);
    if (title) {
      return { id: null, title, resolution: 'unresolved' };
    }
  }

  // Every id-bearing path missed. Surface the discovered title (if any) so
  // the caller can still display a human-readable label while metadata
  // continues to flag the call as unresolved.
  if (discoveredTitleHint) {
    return { id: null, title: discoveredTitleHint, resolution: 'unresolved' };
  }

  return { id: null, title: null, resolution: 'unresolved' };
}

interface PendingAudit {
  kind: 'promoted' | 'call_resynced' | 'call_resync_unresolved';
  projectId: string;
  rawSelectedCallId: string;
  resolvedCallId: string | null;
  selectedCallResolution: CallResolution;
  previousRawSelectedCallId?: string | null;
  previousResolvedCallId?: string | null;
  titleSource?: TitleSource;
}

export async function ensureProjectForSession(
  ctx: ServiceContext,
  sessionId: string,
  opts: EnsureOpts = {},
): Promise<PromotionResult> {
  const { userId, requestId } = ctx;

  try {
    const { result, auditData } = await withUserRLS(userId, async (tx): Promise<{ result: PromotionResult; auditData: PendingAudit | null }> => {
      // Step 1 — lock session, ownership-checked
      const sessionRows = await tx
        .select({
          id: agentSessions.id,
          userId: agentSessions.userId,
          projectId: agentSessions.projectId,
          selectedCallId: agentSessions.selectedCallId,
          locale: agentSessions.locale,
          messageSummary: agentSessions.messageSummary,
          planningArtifact: agentSessions.planningArtifact,
        })
        .from(agentSessions)
        .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
        .for('update')
        .limit(1);

      if (sessionRows.length === 0) {
        return { result: { promoted: false, reason: 'SESSION_NOT_FOUND' }, auditData: null };
      }
      const session = sessionRows[0];

      if (session.projectId === null && session.selectedCallId === null) {
        return { result: { promoted: false, reason: 'NO_SELECTED_CALL' }, auditData: null };
      }

      if (session.projectId !== null) {
        const projectRows = await tx
          .select({
            id: projects.id,
            metadata: projects.metadata,
            callId: projects.callId,
            title: projects.title,
          })
          .from(projects)
          .where(eq(projects.id, session.projectId))
          .for('update')
          .limit(1);
        if (projectRows.length === 0) {
          return { result: { promoted: false, reason: 'SESSION_NOT_FOUND' }, auditData: null };
        }
        const project = projectRows[0];
        const existingMetadata = (project.metadata ?? {}) as Record<string, unknown>;
        const recordedCallId = existingMetadata.rawSelectedCallId as string | undefined;
        const previousRawSelectedCallId = typeof recordedCallId === 'string' ? recordedCallId : null;
        const previousResolvedCallId = project.callId;

        if (recordedCallId === session.selectedCallId) {
          const titleRepairNeeded = (
            typeof project.title === 'string'
            && isCompactedToolSummary(project.title)
          );
          const callRepairNeeded = project.callId === null || existingMetadata.selectedCallResolution === 'unresolved';
          if (callRepairNeeded || titleRepairNeeded) {
            const callResult = await resolveCallForId(tx, session.selectedCallId!);
            const existingResolvedCallTitle = typeof existingMetadata.resolvedCallTitle === 'string'
              ? existingMetadata.resolvedCallTitle
              : null;
            const resolvedCallTitle = callResult.title ?? existingResolvedCallTitle;
            const titleResult = titleRepairNeeded
              ? deriveProjectTitle(
                  deriveTitleInput({
                    selectedCallId: session.selectedCallId!,
                    messageSummary: session.messageSummary,
                    planningArtifact: session.planningArtifact,
                  }),
                  session.locale as 'ro' | 'en',
                  resolvedCallTitle,
                )
              : null;
            // deriveProjectTitle already drops compacted messageSummary
            // values via isCompactedToolSummary, so any titleResult that
            // reaches this branch is by construction a clean replacement —
            // including a 'messageSummary' source. Refusing it here was
            // the bug that left a compacted title pinned forever when the
            // current summary was already clean.
            const titleChanged = Boolean(
              titleResult
              && titleResult.title !== project.title,
            );
            const callChanged = callResult.id !== null && callResult.id !== project.callId;
            const titleMetadataChanged = Boolean(titleResult && titleResult.source !== existingMetadata.titleSource);
            const callMetadataChanged = (
              resolvedCallTitle !== (existingMetadata.resolvedCallTitle ?? null)
              || callResult.resolution !== existingMetadata.selectedCallResolution
            );

            if (callChanged || titleChanged || titleMetadataChanged || callMetadataChanged) {
              await tx
                .update(projects)
                .set({
                  ...(callChanged ? { callId: callResult.id } : {}),
                  ...(titleChanged && titleResult ? { title: titleResult.title } : {}),
                  metadata: {
                    ...existingMetadata,
                    agentSessionId: sessionId,
                    rawSelectedCallId: session.selectedCallId,
                    resolvedCallTitle,
                    selectedCallResolution: callResult.resolution,
                    ...(titleResult ? { titleSource: titleResult.source } : {}),
                  },
                  updatedAt: new Date(),
                })
                .where(eq(projects.id, project.id));

              const audit: PendingAudit = {
                kind: callResult.id === null ? 'call_resync_unresolved' : 'call_resynced',
                projectId: project.id,
                rawSelectedCallId: session.selectedCallId!,
                resolvedCallId: callResult.id,
                selectedCallResolution: callResult.resolution,
                previousRawSelectedCallId,
                previousResolvedCallId,
                titleSource: titleResult?.source,
              };

              return {
                result: callResult.id === null
                  ? {
                      promoted: true,
                      projectId: project.id,
                      created: false,
                      synced: false,
                      resyncUnresolved: true,
                    }
                  : { promoted: true, projectId: project.id, created: false, synced: true },
                auditData: audit,
              };
            }
          }
          return { result: { promoted: true, projectId: project.id, created: false, synced: false }, auditData: null };
        }

        const callResult = await resolveCallForId(tx, session.selectedCallId!);
        if (callResult.id === null) {
          const audit: PendingAudit = {
            kind: 'call_resync_unresolved',
            projectId: project.id,
            rawSelectedCallId: session.selectedCallId!,
            resolvedCallId: null,
            selectedCallResolution: callResult.resolution,
            previousRawSelectedCallId,
            previousResolvedCallId,
          };

          return {
            result: {
              promoted: true,
              projectId: project.id,
              created: false,
              synced: false,
              resyncUnresolved: true,
            },
            auditData: audit,
          };
        }

        await tx
          .update(projects)
          .set({
            callId: callResult.id,
            metadata: {
              ...existingMetadata,
              agentSessionId: sessionId,
              rawSelectedCallId: session.selectedCallId,
              resolvedCallTitle: callResult.title,
              selectedCallResolution: callResult.resolution,
            },
            updatedAt: new Date(),
          })
          .where(eq(projects.id, project.id));

        const audit: PendingAudit = {
          kind: 'call_resynced',
          projectId: project.id,
          rawSelectedCallId: session.selectedCallId!,
          resolvedCallId: callResult.id,
          selectedCallResolution: callResult.resolution,
          previousRawSelectedCallId,
          previousResolvedCallId,
        };

        return { result: { promoted: true, projectId: project.id, created: false, synced: true }, auditData: audit };
      }

      // Branch B: fresh promotion
      const userRows = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (userRows.length === 0) {
        return { result: { promoted: false, reason: 'USER_NOT_FOUND' }, auditData: null };
      }

      // Agent-driven promotion: no UI in the loop, so we cannot prompt the
      // user to disambiguate when they belong to 2+ orgs. Auto-pick the
      // oldest membership (their "primary" org). The explicit POST
      // /api/v1/projects route does NOT pass this flag — it keeps the 409
      // contract so API clients stay deliberate.
      const orgId = await resolveProjectOrgIdInTx(tx, userId, undefined, { autoPickOnAmbiguous: true });

      const callResult = await resolveCallForId(tx, session.selectedCallId!);
      const titleResult = deriveProjectTitle(
        deriveTitleInput({
          selectedCallId: session.selectedCallId!,
          messageSummary: session.messageSummary,
          planningArtifact: session.planningArtifact,
        }),
        session.locale as 'ro' | 'en',
        callResult.title,
      );

      const [created] = await tx
        .insert(projects)
        .values({
          orgId,
          userId,
          callId: callResult.id,
          createdBy: userId,
          title: titleResult.title,
          status: 'ciorna',
          currentVersion: 1,
          metadata: {
            agentSessionId: sessionId,
            rawSelectedCallId: session.selectedCallId!,
            resolvedCallTitle: callResult.title,
            titleSource: titleResult.source,
            selectedCallResolution: callResult.resolution,
            promotedAt: ctx.now.toISOString(),
          },
        })
        .returning({ id: projects.id });

      await tx
        .update(agentSessions)
        .set({ projectId: created.id, updatedAt: new Date() })
        .where(eq(agentSessions.id, sessionId));

      const audit: PendingAudit = {
        kind: 'promoted',
        projectId: created.id,
        rawSelectedCallId: session.selectedCallId!,
        resolvedCallId: callResult.id,
        selectedCallResolution: callResult.resolution,
        titleSource: titleResult.source,
      };

      const promotionResult: PromotionResult = {
        promoted: true,
        projectId: created.id,
        created: true,
        titleSource: titleResult.source,
        selectedCallResolution: callResult.resolution,
      };

      // Step 8 — dry-run sentinel.
      if (opts.dryRun) {
        throw new DryRunRollback(promotionResult);
      }

      return { result: promotionResult, auditData: audit };
    });

    // Step 9 — post-commit audit + metric
    if (auditData) {
      await logAudit({
        userId,
        action: 'project.promoted_from_session',
        resourceType: 'project',
        resourceId: auditData.projectId,
        metadata: {
          agentSessionId: sessionId,
          rawSelectedCallId: auditData.rawSelectedCallId,
          resolvedCallId: auditData.resolvedCallId,
          selectedCallResolution: auditData.selectedCallResolution,
          previousRawSelectedCallId: auditData.previousRawSelectedCallId,
          previousResolvedCallId: auditData.previousResolvedCallId,
          titleSource: auditData.titleSource,
          kind: auditData.kind,
          requestId,
        },
      });
    }

    if (result.promoted) {
      const outcome = result.created
        ? 'promoted'
        : (result.synced ? 'synced' : (result.resyncUnresolved ? 'resync_unresolved' : 'already_linked'));
      trackProjectPromotion(outcome);
      log.info({ sessionId, projectId: result.projectId, outcome }, 'session promoted');
    } else {
      const map = {
        NO_SELECTED_CALL: 'no_selected_call',
        USER_NOT_FOUND: 'user_missing',
        SESSION_NOT_FOUND: 'session_missing',
      } as const;
      trackProjectPromotion(map[result.reason]);
      log.warn({ sessionId, reason: result.reason }, 'session not promotable');
    }

    return result;
  } catch (e) {
    if (e instanceof DryRunRollback) {
      return e.carried as PromotionResult;
    }
    trackProjectPromotion('failed');
    log.error({ sessionId, error: e instanceof Error ? e.message : String(e) }, 'promotion failed');
    throw e;
  }
}
