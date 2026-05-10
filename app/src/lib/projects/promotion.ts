// app/src/lib/projects/promotion.ts
//
// Session-to-project promotion. See spec:
//   docs/superpowers/specs/2026-05-02-session-to-project-promotion-design.md
//
// A projects row is the canonical project shell. An agent_session is an AI
// drafting workspace attached to that project via agent_sessions.project_id.
// This module owns the lifecycle transition that links the two.

import { and, eq, sql } from 'drizzle-orm';
import { withUserRLS } from '@/lib/db';
import { agentSessions, projects, users, callsForProposals } from '@/lib/db/schema';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { trackProjectPromotion } from '@/lib/monitoring/metrics';
import { resolveProjectOrgIdInTx } from '@/lib/projects/org-resolver';
import { UUID_RE } from '@/lib/validators/patterns';
import type { Database } from '@/lib/db';
import type { ServiceContext } from '@/lib/ai/agent/services/types';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const log = logger.child({ component: 'project-promotion' });

export type CallResolution = 'id' | 'callCode' | 'externalId' | 'unresolved';
export type TitleSource = 'description' | 'messageSummary' | 'fallback';

export type PromotionResult =
  | {
      promoted: true;
      projectId: string;
      created: true;
      titleSource: TitleSource;
      selectedCallResolution: CallResolution;
    }
  | { promoted: true; projectId: string; created: false; synced: boolean }
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

/** Minimal shape used by the title derivation; kept narrow on purpose. */
export interface SessionForTitle {
  selectedCallId: string;
  messageSummary: string | null;
  planningArtifact: { preselect?: { description?: string } } | null;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

export function deriveProjectTitle(
  session: SessionForTitle,
  locale: 'ro' | 'en',
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
    return { title: truncate(normalizeWhitespace(summary), TITLE_MAX_LEN), source: 'messageSummary' };
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

/**
 * Three-prong probe against calls_for_proposals.
 *   1. id (only if input matches UUID_RE)
 *   2. call_code (globally unique per schema.ts:300)
 *   3. external_id (NOT globally unique — uniqueness is per source_connector_id;
 *      LIMIT 2 + exact-one check; multi-match → unresolved to avoid linking the
 *      wrong FK)
 */
export async function resolveCallForId(
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

interface PendingAudit {
  kind: 'promoted' | 'call_resynced';
  projectId: string;
  rawSelectedCallId: string;
  resolvedCallId: string | null;
  selectedCallResolution: CallResolution;
  titleSource?: TitleSource;
}

export async function ensureProjectForSession(
  ctx: ServiceContext,
  sessionId: string,
  opts: EnsureOpts = {},
): Promise<PromotionResult> {
  const { userId, requestId } = ctx;
  let pendingAudit: PendingAudit | null = null;

  try {
    const result = await withUserRLS(userId, async (tx) => {
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
        return { promoted: false, reason: 'SESSION_NOT_FOUND' as const };
      }
      const session = sessionRows[0];

      if (session.projectId === null && session.selectedCallId === null) {
        return { promoted: false, reason: 'NO_SELECTED_CALL' as const };
      }

      if (session.projectId !== null) {
        // Branch A: already linked. Implemented in Task 8.
        throw new Error('already-linked branch not yet implemented (Task 8)');
      }

      // Branch B: fresh promotion
      const userRows = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (userRows.length === 0) {
        return { promoted: false, reason: 'USER_NOT_FOUND' as const };
      }

      const orgId = await resolveProjectOrgIdInTx(tx, userId);

      const callResult = await resolveCallForId(tx, session.selectedCallId!);
      const titleResult = deriveProjectTitle(
        {
          selectedCallId: session.selectedCallId!,
          messageSummary: session.messageSummary,
          planningArtifact: session.planningArtifact as { preselect?: { description?: string } } | null,
        },
        session.locale as 'ro' | 'en',
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

      pendingAudit = {
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

      // Step 8 — dry-run sentinel. Implemented in Task 9.
      if (opts.dryRun) {
        throw new Error('dry-run not yet implemented (Task 9)');
      }

      return promotionResult;
    });

    // Step 9 — post-commit audit + metric
    if (pendingAudit) {
      await logAudit({
        userId,
        action: 'project.promoted_from_session',
        resourceType: 'project',
        resourceId: pendingAudit.projectId,
        metadata: {
          agentSessionId: sessionId,
          rawSelectedCallId: pendingAudit.rawSelectedCallId,
          resolvedCallId: pendingAudit.resolvedCallId,
          selectedCallResolution: pendingAudit.selectedCallResolution,
          titleSource: pendingAudit.titleSource,
          kind: pendingAudit.kind,
          requestId,
        },
      });
    }

    if (result.promoted) {
      const outcome = result.created ? 'promoted' : ((result as any).synced ? 'synced' : 'already_linked');
      trackProjectPromotion(outcome as any);
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
    log.error({ sessionId, error: e instanceof Error ? e.message : String(e) }, 'promotion failed');
    throw e;
  }
}
