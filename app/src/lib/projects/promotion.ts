// app/src/lib/projects/promotion.ts
//
// Session-to-project promotion. See spec:
//   docs/superpowers/specs/2026-05-02-session-to-project-promotion-design.md
//
// A projects row is the canonical project shell. An agent_session is an AI
// drafting workspace attached to that project via agent_sessions.project_id.
// This module owns the lifecycle transition that links the two.

import type { ServiceContext } from '@/lib/ai/agent/services/types';

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

  const idFragment = session.selectedCallId.slice(0, 11);
  const title = locale === 'en'
    ? `Untitled project — ${idFragment}`
    : `Proiect nou — ${idFragment}`;
  return { title, source: 'fallback' };
}

export async function ensureProjectForSession(
  _ctx: ServiceContext,
  _sessionId: string,
  _opts: EnsureOpts = {},
): Promise<PromotionResult> {
  throw new Error('not implemented');
}
