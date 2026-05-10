// app/src/lib/projects/promotion.ts
//
// Session-to-project promotion. See spec:
//   docs/superpowers/specs/2026-05-02-session-to-project-promotion-design.md
//
// A projects row is the canonical project shell. An agent_session is an AI
// drafting workspace attached to that project via agent_sessions.project_id.
// This module owns the lifecycle transition that links the two.

import { and, eq, sql } from 'drizzle-orm';
import { callsForProposals } from '@/lib/db/schema';
import { UUID_RE } from '@/lib/validators/patterns';
import type { Database } from '@/lib/db';
import type { ServiceContext } from '@/lib/ai/agent/services/types';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

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

export async function ensureProjectForSession(
  _ctx: ServiceContext,
  _sessionId: string,
  _opts: EnsureOpts = {},
): Promise<PromotionResult> {
  throw new Error('not implemented');
}
