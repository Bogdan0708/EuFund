# Senior Review PR 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `requestSeniorReview()` primitive plus its backend, audit persistence, budget accounting, feature flags, and metrics — with no gate callers wired yet. Delivers PR 1 of the 5-PR rollout defined in `docs/superpowers/specs/2026-04-14-senior-review-primitive-design.md`.

**Architecture:** A new module at `app/src/lib/ai/agent/senior-review/` holds the service, backend, audit, config, prompts, gate helpers, and budget accounting. Two new DB tables (`agent_senior_reviews`, `agent_senior_review_attempts`) capture audit trail with separate logical-review and attempt identity. Backend is a single `messages.create` call to Opus via the existing Anthropic provider (`lib/ai/providers/anthropic.ts`). No gates are wired to service-layer callers in this PR; that starts in PR 2.

**Tech Stack:** TypeScript, Drizzle ORM + PostgreSQL, Zod, Vitest, existing `@anthropic-ai/sdk` (via OpenAI-SDK compatibility shim), existing `lib/monitoring/metrics.ts`, existing `lib/feature-flags`.

**Spec reference:** `docs/superpowers/specs/2026-04-14-senior-review-primitive-design.md` (commit `a2dfd60`). All section refs (§N) in this plan point there.

**Prerequisite:** Managed Agents Phase 3 work merged to master before this PR opens (per spec §10.7). Do not parallelize.

## Plan revisions

**2026-04-14 audit fixes (commit pending):**
- **Fix 1 (RLS execution path):** RLS `ALTER TABLE` + `CREATE POLICY` statements now live inside `0025_senior_review_audit.sql` (the only SQL executed by `migrate.ts`). The `rls.sql` edit is kept as a developer-reference mirror, clearly labelled as non-executed.
- **Fix 2 (RLS-aware DB access):** `audit.ts` and `budget.ts` now take a `userId` argument and wrap all queries in `withUserRLS(userId, ...)` so the new RLS policies see the tenant. Callers (service, gate helpers, tests) pass `userId` through.
- **Fix 3 (flag targeting context):** `requestSeniorReview()` accepts `userId` and optional `tier`; both are forwarded to every `isFeatureEnabled()` call so percentage rollout and tier targeting actually resolve instead of silently returning false.
- **Fix 4 (provider field):** Backend call includes `provider: 'anthropic'` as required by `GenerateRequest`.
- **Fix 5 (metrics circular import + format):** `senior-review/metrics.ts` self-registers on module load; no reverse import into `monitoring/metrics.ts`. Eager bootstrap is via a side-effect import in `instrumentation.ts` (if present). Histogram assertion loosened to match the existing registry's non-standard output format.
- **Fix 6 (auditRef nullability):** `SeniorReview.auditRef` is now `string | null`. Returned as `null` when no review row was persisted (flag-disabled path). Callers must not persist null as a FK — documented in the type.

All fixes land as edits to the tasks below, not a separate patch task. Any engineer executing the plan reads the current task bodies, which already reflect the fixes.

---

## File Map

**New files:**
- `app/src/lib/ai/agent/senior-review/types.ts` — shared TS types (Stage, ReviewVerdict, SeniorReview, status enums, typed errors)
- `app/src/lib/ai/agent/senior-review/schemas.ts` — Zod schemas for review response and audit shapes
- `app/src/lib/ai/agent/senior-review/config.ts` — per-stage GateConfig, retry budget, caps, feature-flag keys
- `app/src/lib/ai/agent/senior-review/prompts.ts` — shared system prompt frame + StageDescriptor builder
- `app/src/lib/ai/agent/senior-review/backend/opus-gateway.ts` — Opus backend via existing Anthropic provider
- `app/src/lib/ai/agent/senior-review/audit.ts` — persistence for reviews + attempts
- `app/src/lib/ai/agent/senior-review/budget.ts` — per-session consult counting for soft/hard caps
- `app/src/lib/ai/agent/senior-review/metrics.ts` — registration + wrapper helpers for Prometheus counters/histograms
- `app/src/lib/ai/agent/senior-review/service.ts` — `requestSeniorReview()` orchestrator
- `app/src/lib/ai/agent/senior-review/gate.ts` — `withSeniorReviewMutation()` + `withSeniorReviewToolResult()` helpers (no callers yet)
- `app/drizzle/0025_senior_review_audit.sql` — migration
- `app/tests/unit/senior-review/fixtures/mock-backend.ts` — reusable mock Opus backend for this PR + future gate PRs
- `app/tests/unit/senior-review/schemas.test.ts`
- `app/tests/unit/senior-review/config.test.ts`
- `app/tests/unit/senior-review/prompts.test.ts`
- `app/tests/unit/senior-review/backend-opus-gateway.test.ts`
- `app/tests/unit/senior-review/audit.test.ts`
- `app/tests/unit/senior-review/budget.test.ts`
- `app/tests/unit/senior-review/service.test.ts`
- `app/tests/unit/senior-review/gate.test.ts`

**Modified files:**
- `app/src/lib/db/schema.ts` — add `agentSeniorReviews` + `agentSeniorReviewAttempts` table definitions
- `app/drizzle/meta/_journal.json` — register migration 25
- `app/src/lib/monitoring/metrics.ts` — register senior-review metrics at module load time
- `app/src/lib/db/rls.sql` — add RLS policies for the two new tables

---

## Task 1: DB migration + Drizzle schema

**Files:**
- Create: `app/drizzle/0025_senior_review_audit.sql`
- Modify: `app/drizzle/meta/_journal.json`
- Modify: `app/src/lib/db/schema.ts` (append after existing `agent_*` tables)
- Modify: `app/src/lib/db/rls.sql`
- Test: `app/tests/unit/senior-review/schema.test.ts`

- [ ] **Step 1: Write the failing schema smoke test**

Create `app/tests/unit/senior-review/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { agentSeniorReviews, agentSeniorReviewAttempts } from '@/lib/db/schema';

describe('senior-review schema', () => {
  it('exports agentSeniorReviews table with expected columns', () => {
    expect(agentSeniorReviews).toBeDefined();
    const cols = Object.keys(agentSeniorReviews);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'sessionId', 'stage', 'invokingMutation', 'invokingToolResult',
      'policyType', 'triggeredBy', 'verdict', 'status', 'failureReason',
      'totalAttempts', 'totalLatencyMs', 'reviewSummary', 'schemaVersion', 'createdAt',
    ]));
  });

  it('exports agentSeniorReviewAttempts table with expected columns', () => {
    expect(agentSeniorReviewAttempts).toBeDefined();
    const cols = Object.keys(agentSeniorReviewAttempts);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'reviewId', 'attemptIndex', 'latencyMs', 'outcome', 'createdAt',
    ]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/schema.test.ts
```
Expected: FAIL — `agentSeniorReviews is not exported from '@/lib/db/schema'`.

- [ ] **Step 3: Write the migration SQL**

Create `app/drizzle/0025_senior_review_audit.sql`:

```sql
-- PR 1: Senior Review primitive — audit tables + RLS policies.
-- One logical review row per consult event; one attempt row per backend call.
-- RLS must be applied here (drizzle migrations are the only SQL the app runs).
-- app/src/lib/db/rls.sql is a design reference, not an execution artifact.
CREATE TABLE IF NOT EXISTS "agent_senior_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "agent_sessions"("id") ON DELETE CASCADE,
  "stage" text NOT NULL,
  "invoking_mutation" text,
  "invoking_tool_result" text,
  "policy_type" text NOT NULL,
  "triggered_by" jsonb,
  "verdict" text,
  "status" text NOT NULL,
  "failure_reason" text,
  "total_attempts" integer NOT NULL DEFAULT 0,
  "total_latency_ms" integer NOT NULL DEFAULT 0,
  "review_summary" text,
  "schema_version" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_senior_review_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "review_id" uuid NOT NULL REFERENCES "agent_senior_reviews"("id") ON DELETE CASCADE,
  "attempt_index" integer NOT NULL,
  "latency_ms" integer NOT NULL,
  "outcome" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_senior_reviews_session" ON "agent_senior_reviews"("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_senior_reviews_stage_status" ON "agent_senior_reviews"("stage", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_senior_review_attempts_review" ON "agent_senior_review_attempts"("review_id");
--> statement-breakpoint

-- RLS: tenant isolation via agent_sessions.user_id (same pattern as existing agent_* tables).
ALTER TABLE "agent_senior_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "senior_reviews_tenant_isolation" ON "agent_senior_reviews"
  USING ("session_id" IN (
    SELECT "id" FROM "agent_sessions"
    WHERE "user_id" = current_setting('app.current_user_id', true)::uuid
  ));
--> statement-breakpoint

ALTER TABLE "agent_senior_review_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "senior_review_attempts_tenant_isolation" ON "agent_senior_review_attempts"
  USING ("review_id" IN (
    SELECT r."id" FROM "agent_senior_reviews" r
    JOIN "agent_sessions" s ON s."id" = r."session_id"
    WHERE s."user_id" = current_setting('app.current_user_id', true)::uuid
  ));
```

- [ ] **Step 4: Register the migration in the journal**

Append to `app/drizzle/meta/_journal.json` inside the `entries` array (before the closing `]`):

```json
    ,{
      "idx": 25,
      "version": "7",
      "when": 1776643200000,
      "tag": "0025_senior_review_audit",
      "breakpoints": true
    }
```

- [ ] **Step 5: Add Drizzle table definitions**

Append to `app/src/lib/db/schema.ts` (after the last `agent_*` export, before any trailing module-level statements):

```typescript
// ─── Senior Review audit tables (PR 1) ────────────────────────────

export const agentSeniorReviews = pgTable('agent_senior_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull(),
  invokingMutation: text('invoking_mutation'),
  invokingToolResult: text('invoking_tool_result'),
  policyType: text('policy_type').notNull(),
  triggeredBy: jsonb('triggered_by'),
  verdict: text('verdict'),
  status: text('status').notNull(),
  failureReason: text('failure_reason'),
  totalAttempts: integer('total_attempts').notNull().default(0),
  totalLatencyMs: integer('total_latency_ms').notNull().default(0),
  reviewSummary: text('review_summary'),
  schemaVersion: text('schema_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxSession: index('idx_senior_reviews_session').on(table.sessionId),
  idxStageStatus: index('idx_senior_reviews_stage_status').on(table.stage, table.status),
}));

export const agentSeniorReviewAttempts = pgTable('agent_senior_review_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id').notNull().references(() => agentSeniorReviews.id, { onDelete: 'cascade' }),
  attemptIndex: integer('attempt_index').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  outcome: text('outcome').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxReview: index('idx_senior_review_attempts_review').on(table.reviewId),
}));
```

If `jsonb`, `integer`, `text`, or `index` imports are missing at the top of `schema.ts`, add them to the existing `drizzle-orm/pg-core` import list.

- [ ] **Step 6: Mirror RLS policies into `rls.sql` design reference**

Keep `app/src/lib/db/rls.sql` in sync with the migration for developer reference. Append the same `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` blocks you just added to the migration. This file is not executed — the drizzle migration is authoritative — but keeping it in sync prevents it from becoming misleading.

- [ ] **Step 7: Run schema smoke test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/schema.test.ts
```
Expected: PASS.

- [ ] **Step 8: Run full typecheck**

```bash
cd app && npm run typecheck
```
Expected: no new errors. Fix any import errors.

- [ ] **Step 9: Commit**

```bash
git add app/drizzle/0025_senior_review_audit.sql app/drizzle/meta/_journal.json \
        app/src/lib/db/schema.ts app/src/lib/db/rls.sql \
        app/tests/unit/senior-review/schema.test.ts
git commit -m "feat(senior-review): add audit tables (PR 1 task 1)"
```

---

## Task 2: Core types + Zod response schemas

**Files:**
- Create: `app/src/lib/ai/agent/senior-review/types.ts`
- Create: `app/src/lib/ai/agent/senior-review/schemas.ts`
- Test: `app/tests/unit/senior-review/schemas.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `app/tests/unit/senior-review/schemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  seniorReviewResponseSchema,
  reviewVerdictSchema,
  consultStatusSchema,
  schemaVersionSchema,
} from '@/lib/ai/agent/senior-review/schemas';

describe('senior-review schemas', () => {
  it('accepts a well-formed proceed verdict', () => {
    const parsed = seniorReviewResponseSchema.parse({
      verdict: 'proceed',
      reasons: [{ ro: 'motiv', en: 'reason' }],
      riskFlags: [],
      schemaVersion: 'v1',
    });
    expect(parsed.verdict).toBe('proceed');
  });

  it('rejects a verdict with invalid enum value', () => {
    expect(() => seniorReviewResponseSchema.parse({
      verdict: 'maybe',
      reasons: [],
      riskFlags: [],
      schemaVersion: 'v1',
    })).toThrow();
  });

  it('requires bilingual reasons with ro+en', () => {
    expect(() => seniorReviewResponseSchema.parse({
      verdict: 'block',
      reasons: [{ ro: 'doar ro' }],
      riskFlags: [],
      schemaVersion: 'v1',
    })).toThrow();
  });

  it('lists all four consult statuses', () => {
    expect(consultStatusSchema.options).toEqual([
      'completed', 'failed_blocked', 'failed_bypassed', 'suppressed_budget',
    ]);
  });

  it('lists all three verdicts', () => {
    expect(reviewVerdictSchema.options).toEqual(['proceed', 'modify', 'block']);
  });

  it('accepts a schemaVersion string', () => {
    expect(schemaVersionSchema.parse('v1')).toBe('v1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/schemas.test.ts
```
Expected: FAIL — module `@/lib/ai/agent/senior-review/schemas` does not exist.

- [ ] **Step 3: Write the types module**

Create `app/src/lib/ai/agent/senior-review/types.ts`:

```typescript
// Senior Review — core types shared across service, backend, audit, gate helpers.
// See docs/superpowers/specs/2026-04-14-senior-review-primitive-design.md §3.2.

export type Stage =
  | 'call_selection'
  | 'outline_freeze'
  | 'eligibility_verdict'
  | 'section_recovery'
  | 'contradiction_override';

export type PolicyType = 'mandatory' | 'conditional';

export type ReviewVerdict = 'proceed' | 'modify' | 'block';

export type ConsultStatus =
  | 'completed'
  | 'failed_blocked'
  | 'failed_bypassed'
  | 'suppressed_budget';

export type AttemptOutcome =
  | 'success'
  | 'timeout'
  | 'rate_limit'
  | 'gateway_degraded'
  | 'network'
  | 'malformed_response';

export type FailureReason = Exclude<AttemptOutcome, 'success'>;

export interface BilingualReason {
  ro: string;
  en: string;
}

export interface SeniorReview<M = unknown> {
  verdict: ReviewVerdict;
  reasons: BilingualReason[];
  riskFlags: string[];
  modifiedInput?: M;
  advisoryNarrative?: BilingualReason;
  rewriteStrategy?: 'tighten' | 'restructure' | 'evidence_repair' | 'scope_reduce';
  // Logical review id (joins to agent_senior_reviews.id + agent_senior_review_attempts.review_id).
  // null when no row was persisted — i.e. feature disabled, or unreachable disabled path.
  // Callers must treat null as "no audit linkage" and must not persist it as a FK.
  auditRef: string | null;
  schemaVersion: string;
  shadowMode?: boolean;
}

// Typed errors surfaced by the backend and handled by the service retry loop.
export class TimeoutError extends Error { readonly outcome = 'timeout' as const; }
export class RateLimitError extends Error { readonly outcome = 'rate_limit' as const; }
export class GatewayDegradedError extends Error { readonly outcome = 'gateway_degraded' as const; }
export class NetworkError extends Error { readonly outcome = 'network' as const; }
export class MalformedResponseError extends Error { readonly outcome = 'malformed_response' as const; }

export type BackendError =
  | TimeoutError
  | RateLimitError
  | GatewayDegradedError
  | NetworkError
  | MalformedResponseError;

export function isRetryableBackendError(err: unknown): boolean {
  return (
    err instanceof TimeoutError ||
    err instanceof RateLimitError ||
    err instanceof GatewayDegradedError ||
    err instanceof NetworkError
  );
  // MalformedResponseError is NOT retryable per spec §5.4.
}
```

- [ ] **Step 4: Write the schemas module**

Create `app/src/lib/ai/agent/senior-review/schemas.ts`:

```typescript
import { z } from 'zod';
import type { Stage } from './types';

export const reviewVerdictSchema = z.enum(['proceed', 'modify', 'block']);
export const consultStatusSchema = z.enum([
  'completed', 'failed_blocked', 'failed_bypassed', 'suppressed_budget',
]);
export const attemptOutcomeSchema = z.enum([
  'success', 'timeout', 'rate_limit', 'gateway_degraded', 'network', 'malformed_response',
]);
export const policyTypeSchema = z.enum(['mandatory', 'conditional']);
export const stageSchema: z.ZodType<Stage> = z.enum([
  'call_selection', 'outline_freeze', 'eligibility_verdict', 'section_recovery', 'contradiction_override',
]);
export const schemaVersionSchema = z.string().min(1);

export const bilingualReasonSchema = z.object({
  ro: z.string().min(1),
  en: z.string().min(1),
});

export const rewriteStrategySchema = z.enum([
  'tighten', 'restructure', 'evidence_repair', 'scope_reduce',
]);

// Generic review response shape — `modifiedInput` validated per-stage in gate helpers.
export const seniorReviewResponseSchema = z.object({
  verdict: reviewVerdictSchema,
  reasons: z.array(bilingualReasonSchema),
  riskFlags: z.array(z.string()),
  modifiedInput: z.unknown().optional(),
  advisoryNarrative: bilingualReasonSchema.optional(),
  rewriteStrategy: rewriteStrategySchema.optional(),
  schemaVersion: schemaVersionSchema,
});

export type SeniorReviewResponse = z.infer<typeof seniorReviewResponseSchema>;

// Contradiction-override consult payload — only stage with a PR 1 schema
// (other stage payloads land in their respective gate PRs).
export const contradictionOverridePayloadSchema = z.object({
  sessionId: z.string().uuid(),
  detectedBy: z.string(),
  conflictingClaims: z.array(z.object({
    claim: z.string(),
    sourceChunkIds: z.array(z.string()),
  })),
  projectSummary: z.string(),
});
```

- [ ] **Step 5: Run schemas test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/schemas.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/agent/senior-review/types.ts \
        app/src/lib/ai/agent/senior-review/schemas.ts \
        app/tests/unit/senior-review/schemas.test.ts
git commit -m "feat(senior-review): core types and response schemas (PR 1 task 2)"
```

---

## Task 3: Config module

**Files:**
- Create: `app/src/lib/ai/agent/senior-review/config.ts`
- Test: `app/tests/unit/senior-review/config.test.ts`

- [ ] **Step 1: Write the failing config test**

Create `app/tests/unit/senior-review/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  RETRY_CONFIG,
  BUDGET_CONFIG,
  GATE_CONFIG,
  FEATURE_FLAG_KEYS,
  CURRENT_SCHEMA_VERSION,
} from '@/lib/ai/agent/senior-review/config';

describe('senior-review config', () => {
  it('retry config matches spec §5.4', () => {
    expect(RETRY_CONFIG).toEqual({
      perAttemptTimeoutMs: 5_000,
      maxAttempts: 3,
      backoffsMs: [300, 1000],
    });
  });

  it('budget config matches spec §5.5', () => {
    expect(BUDGET_CONFIG).toEqual({
      conditionalSoftCap: 8,
      conditionalHardCap: 12,
    });
  });

  it('gates are declared for all four named stages with correct policy types', () => {
    expect(GATE_CONFIG.call_selection.policyType).toBe('mandatory');
    expect(GATE_CONFIG.outline_freeze.policyType).toBe('mandatory');
    expect(GATE_CONFIG.eligibility_verdict.policyType).toBe('conditional');
    expect(GATE_CONFIG.section_recovery.policyType).toBe('conditional');
  });

  it('all gates default to enabled=true at stage level (kill switches)', () => {
    for (const gate of Object.values(GATE_CONFIG)) {
      expect(gate.enabled).toBe(true);
    }
  });

  it('exports both feature flag keys', () => {
    expect(FEATURE_FLAG_KEYS).toEqual({
      enabled: 'senior_review_enabled',
      shadowMode: 'senior_review_shadow_mode',
    });
  });

  it('has a current schema version string', () => {
    expect(CURRENT_SCHEMA_VERSION).toMatch(/^v\d+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/config.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the config module**

Create `app/src/lib/ai/agent/senior-review/config.ts`:

```typescript
// Senior Review runtime config. Hot-tunable values live here so incident
// response and calibration do not require code deploys.
// See spec §5.4, §5.5, §7.

import type { Stage, PolicyType } from './types';

export const CURRENT_SCHEMA_VERSION = 'v1';

export const RETRY_CONFIG = {
  perAttemptTimeoutMs: 5_000,
  maxAttempts: 3,
  backoffsMs: [300, 1000] as const,
} as const;

export const BUDGET_CONFIG = {
  conditionalSoftCap: 8,
  conditionalHardCap: 12,
} as const;

export const FEATURE_FLAG_KEYS = {
  enabled: 'senior_review_enabled',
  shadowMode: 'senior_review_shadow_mode',
} as const;

export interface GateConfig {
  stage: Stage;
  policyType: PolicyType;
  enabled: boolean;
  modelId: string;
}

// Per-stage config. `enabled` is the §7.2 kill-switch. PR 1 ships all
// gates declared but unreferenced; PRs 2-5 wire them into service functions.
export const GATE_CONFIG: Record<Exclude<Stage, 'contradiction_override'>, GateConfig> & {
  contradiction_override: GateConfig;
} = {
  call_selection: {
    stage: 'call_selection',
    policyType: 'mandatory',
    enabled: true,
    modelId: 'claude-opus-4-6',
  },
  outline_freeze: {
    stage: 'outline_freeze',
    policyType: 'mandatory',
    enabled: true,
    modelId: 'claude-opus-4-6',
  },
  eligibility_verdict: {
    stage: 'eligibility_verdict',
    policyType: 'conditional',
    enabled: true,
    modelId: 'claude-opus-4-6',
  },
  section_recovery: {
    stage: 'section_recovery',
    policyType: 'conditional',
    enabled: true,
    modelId: 'claude-opus-4-6',
  },
  contradiction_override: {
    stage: 'contradiction_override',
    policyType: 'conditional',
    enabled: true,
    modelId: 'claude-opus-4-6',
  },
};
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/config.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/senior-review/config.ts \
        app/tests/unit/senior-review/config.test.ts
git commit -m "feat(senior-review): runtime config and kill switches (PR 1 task 3)"
```

---

## Task 4: Prompts module

**Files:**
- Create: `app/src/lib/ai/agent/senior-review/prompts.ts`
- Test: `app/tests/unit/senior-review/prompts.test.ts`

- [ ] **Step 1: Write the failing prompts test**

Create `app/tests/unit/senior-review/prompts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildStageTurn } from '@/lib/ai/agent/senior-review/prompts';

describe('senior-review prompts', () => {
  it('system prompt mentions senior reviewer role and bilingual output', () => {
    const sys = buildSystemPrompt();
    expect(sys).toMatch(/senior reviewer/i);
    expect(sys).toMatch(/Romanian/i);
    expect(sys).toMatch(/English/i);
    expect(sys).toMatch(/runtime commits/i);
  });

  it('system prompt forbids modifying fields outside stage schema', () => {
    const sys = buildSystemPrompt();
    expect(sys).toMatch(/modifiedInput/);
    expect(sys).toMatch(/stage schema/i);
  });

  it('stage turn wraps payload in structured tags', () => {
    const turn = buildStageTurn('contradiction_override', { foo: 'bar' });
    expect(turn).toContain('<stage>contradiction_override</stage>');
    expect(turn).toContain('<payload>');
    expect(turn).toContain('"foo":"bar"');
    expect(turn).toContain('<task>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/prompts.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write the prompts module**

Create `app/src/lib/ai/agent/senior-review/prompts.ts`:

```typescript
// Senior Review prompt builder. Shared system prompt frame + per-stage
// user-turn envelope. Stage-specific instructions are appended as structured
// context, not chain-of-thought guidance.
// See spec §5.1.

import type { Stage } from './types';

const SYSTEM_PROMPT = `You are a senior reviewer for EU funding applications in the EuFund platform.

You advise the runtime. The runtime commits. You do not directly change state.

Output constraints:
- Respond via the return_review tool call only.
- Provide bilingual reasons (Romanian + English). Both required for every reason entry.
- verdict must be one of: proceed, modify, block.
- modifiedInput, when present, must validate against the stage schema — it may only alter the fields that stage allows. Freeform structural invention is rejected.
- riskFlags are short tokens identifying categories of concern. Use them sparingly.
- Do not contradict deterministic tool outputs. You may annotate, reframe, or caution, but you must not replace the underlying result.`;

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildStageTurn(stage: Stage, payload: unknown): string {
  const payloadJson = JSON.stringify(payload);
  return `<stage>${stage}</stage>\n<payload>${payloadJson}</payload>\n<task>Review this decision and return a verdict via return_review.</task>`;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/prompts.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/senior-review/prompts.ts \
        app/tests/unit/senior-review/prompts.test.ts
git commit -m "feat(senior-review): system prompt and stage turn builder (PR 1 task 4)"
```

---

## Task 5: Mock backend fixture (reusable)

**Files:**
- Create: `app/tests/unit/senior-review/fixtures/mock-backend.ts`
- Test: `app/tests/unit/senior-review/fixtures/mock-backend.test.ts`

Ship the fixture first because subsequent tasks' tests depend on it. The fixture is importable by PRs 2–5 too.

- [ ] **Step 1: Write the failing fixture self-test**

Create `app/tests/unit/senior-review/fixtures/mock-backend.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createMockBackend } from './mock-backend';
import { TimeoutError, RateLimitError, MalformedResponseError } from '@/lib/ai/agent/senior-review/types';

describe('mock senior-review backend', () => {
  it('returns queued successful response', async () => {
    const backend = createMockBackend();
    backend.queueSuccess({
      verdict: 'proceed',
      reasons: [{ ro: 'ok', en: 'ok' }],
      riskFlags: [],
      schemaVersion: 'v1',
    });
    const result = await backend.consult({ stage: 'contradiction_override', payload: {}, modelId: 'claude-opus-4-6', timeoutMs: 5000 });
    expect(result.verdict).toBe('proceed');
  });

  it('throws TimeoutError when queued', async () => {
    const backend = createMockBackend();
    backend.queueError(new TimeoutError('timeout'));
    await expect(
      backend.consult({ stage: 'contradiction_override', payload: {}, modelId: 'claude-opus-4-6', timeoutMs: 5000 })
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('tracks call count', async () => {
    const backend = createMockBackend();
    backend.queueSuccess({ verdict: 'proceed', reasons: [], riskFlags: [], schemaVersion: 'v1' });
    await backend.consult({ stage: 'contradiction_override', payload: {}, modelId: 'claude-opus-4-6', timeoutMs: 5000 });
    expect(backend.callCount).toBe(1);
  });

  it('throws MalformedResponseError when queued', async () => {
    const backend = createMockBackend();
    backend.queueError(new MalformedResponseError('bad json'));
    await expect(
      backend.consult({ stage: 'contradiction_override', payload: {}, modelId: 'claude-opus-4-6', timeoutMs: 5000 })
    ).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('throws when response queue is empty', async () => {
    const backend = createMockBackend();
    await expect(
      backend.consult({ stage: 'contradiction_override', payload: {}, modelId: 'claude-opus-4-6', timeoutMs: 5000 })
    ).rejects.toThrow(/mock backend.*empty/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/fixtures/mock-backend.test.ts
```
Expected: FAIL — fixture does not exist.

- [ ] **Step 3: Write the fixture**

Create `app/tests/unit/senior-review/fixtures/mock-backend.ts`:

```typescript
import type { SeniorReviewResponse } from '@/lib/ai/agent/senior-review/schemas';
import type { BackendError, Stage } from '@/lib/ai/agent/senior-review/types';

export interface ConsultRequest {
  stage: Stage;
  payload: unknown;
  modelId: string;
  timeoutMs: number;
}

type QueuedItem =
  | { kind: 'success'; response: SeniorReviewResponse }
  | { kind: 'error'; error: BackendError };

// Structurally matches SeniorReviewBackend from service.ts — no need to
// import that interface, structural typing handles assignability.
export interface MockBackend {
  consult(req: ConsultRequest): Promise<SeniorReviewResponse>;
  queueSuccess(response: SeniorReviewResponse): void;
  queueError(error: BackendError): void;
  callCount: number;
  lastRequest?: ConsultRequest;
  reset(): void;
}

export function createMockBackend(): MockBackend {
  const queue: QueuedItem[] = [];
  const mock: MockBackend = {
    callCount: 0,
    lastRequest: undefined,
    queueSuccess(response) { queue.push({ kind: 'success', response }); },
    queueError(error) { queue.push({ kind: 'error', error }); },
    reset() { queue.length = 0; mock.callCount = 0; mock.lastRequest = undefined; },
    async consult(req) {
      mock.callCount += 1;
      mock.lastRequest = req;
      const next = queue.shift();
      if (!next) throw new Error('mock backend response queue is empty');
      if (next.kind === 'error') throw next.error;
      return next.response;
    },
  };
  return mock;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/fixtures/mock-backend.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/tests/unit/senior-review/fixtures/mock-backend.ts \
        app/tests/unit/senior-review/fixtures/mock-backend.test.ts
git commit -m "test(senior-review): reusable mock backend fixture (PR 1 task 5)"
```

---

## Task 6: Opus gateway backend

**Files:**
- Create: `app/src/lib/ai/agent/senior-review/backend/opus-gateway.ts`
- Test: `app/tests/unit/senior-review/backend-opus-gateway.test.ts`

- [ ] **Step 1: Write the failing backend test**

Create `app/tests/unit/senior-review/backend-opus-gateway.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/providers/anthropic', () => ({
  anthropicProvider: { generate: vi.fn() },
}));

import { consultOpus } from '@/lib/ai/agent/senior-review/backend/opus-gateway';
import { anthropicProvider } from '@/lib/ai/providers/anthropic';
import {
  TimeoutError, RateLimitError, GatewayDegradedError, NetworkError, MalformedResponseError,
} from '@/lib/ai/agent/senior-review/types';

const gen = anthropicProvider.generate as ReturnType<typeof vi.fn>;

describe('consultOpus backend', () => {
  beforeEach(() => { gen.mockReset(); });

  it('parses a well-formed tool_use response into a SeniorReviewResponse', async () => {
    gen.mockResolvedValue({
      content: '',
      tokensUsed: { input: 100, output: 50 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      toolCalls: [{
        id: 'tc1',
        name: 'return_review',
        arguments: JSON.stringify({
          verdict: 'proceed',
          reasons: [{ ro: 'motiv', en: 'reason' }],
          riskFlags: [],
          schemaVersion: 'v1',
        }),
      }],
    });

    const result = await consultOpus({
      stage: 'contradiction_override',
      payload: { foo: 'bar' },
      modelId: 'claude-opus-4-6',
      timeoutMs: 5000,
    });

    expect(result.verdict).toBe('proceed');
    expect(gen).toHaveBeenCalledOnce();
  });

  it('throws MalformedResponseError when tool_use args are invalid JSON', async () => {
    gen.mockResolvedValue({
      content: '', tokensUsed: { input: 0, output: 0 }, model: 'x', provider: 'anthropic',
      toolCalls: [{ id: 'tc1', name: 'return_review', arguments: 'not json' }],
    });
    await expect(consultOpus({
      stage: 'contradiction_override', payload: {}, modelId: 'x', timeoutMs: 5000,
    })).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('throws MalformedResponseError when response fails Zod validation', async () => {
    gen.mockResolvedValue({
      content: '', tokensUsed: { input: 0, output: 0 }, model: 'x', provider: 'anthropic',
      toolCalls: [{ id: 'tc1', name: 'return_review', arguments: JSON.stringify({ verdict: 'maybe' }) }],
    });
    await expect(consultOpus({
      stage: 'contradiction_override', payload: {}, modelId: 'x', timeoutMs: 5000,
    })).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('throws MalformedResponseError when no tool_use block is present', async () => {
    gen.mockResolvedValue({
      content: 'free text', tokensUsed: { input: 0, output: 0 }, model: 'x', provider: 'anthropic',
    });
    await expect(consultOpus({
      stage: 'contradiction_override', payload: {}, modelId: 'x', timeoutMs: 5000,
    })).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('throws TimeoutError when provider rejects with timeout', async () => {
    gen.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    await expect(consultOpus({
      stage: 'contradiction_override', payload: {}, modelId: 'x', timeoutMs: 5000,
    })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('throws RateLimitError on 429', async () => {
    gen.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    await expect(consultOpus({
      stage: 'contradiction_override', payload: {}, modelId: 'x', timeoutMs: 5000,
    })).rejects.toBeInstanceOf(RateLimitError);
  });

  it('throws GatewayDegradedError on 5xx', async () => {
    gen.mockRejectedValue(Object.assign(new Error('bad gateway'), { status: 503 }));
    await expect(consultOpus({
      stage: 'contradiction_override', payload: {}, modelId: 'x', timeoutMs: 5000,
    })).rejects.toBeInstanceOf(GatewayDegradedError);
  });

  it('throws NetworkError on generic network failure', async () => {
    gen.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    await expect(consultOpus({
      stage: 'contradiction_override', payload: {}, modelId: 'x', timeoutMs: 5000,
    })).rejects.toBeInstanceOf(NetworkError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/backend-opus-gateway.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the backend**

Create `app/src/lib/ai/agent/senior-review/backend/opus-gateway.ts`:

```typescript
// Senior Review backend: single structured messages.create via the existing
// Anthropic provider. Translates provider errors into typed BackendError
// subclasses. v1 uses the anthropicProvider directly; a future backend can
// swap in the managed-runtime or native Advisor path without changing callers.
// See spec §3.1, §5.1, §13.

import { anthropicProvider } from '@/lib/ai/providers/anthropic';
import { seniorReviewResponseSchema, type SeniorReviewResponse } from '../schemas';
import { buildSystemPrompt, buildStageTurn } from '../prompts';
import {
  TimeoutError, RateLimitError, GatewayDegradedError, NetworkError, MalformedResponseError,
} from '../types';
import type { Stage } from '../types';

interface ConsultRequest {
  stage: Stage;
  payload: unknown;
  modelId: string;
  timeoutMs: number;
}

// Anthropic-tool-call schema forcing structured output. Runtime contract:
// the model must return via return_review. Provider-neutral from the caller's
// POV — this shape is an implementation detail of the backend only.
const RETURN_REVIEW_TOOL = {
  type: 'function' as const,
  function: {
    name: 'return_review',
    description: 'Return the review verdict in structured form.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'reasons', 'riskFlags', 'schemaVersion'],
      properties: {
        verdict: { type: 'string', enum: ['proceed', 'modify', 'block'] },
        reasons: {
          type: 'array',
          items: {
            type: 'object',
            required: ['ro', 'en'],
            properties: { ro: { type: 'string' }, en: { type: 'string' } },
          },
        },
        riskFlags: { type: 'array', items: { type: 'string' } },
        modifiedInput: {},
        advisoryNarrative: {
          type: 'object',
          required: ['ro', 'en'],
          properties: { ro: { type: 'string' }, en: { type: 'string' } },
        },
        rewriteStrategy: {
          type: 'string',
          enum: ['tighten', 'restructure', 'evidence_repair', 'scope_reduce'],
        },
        schemaVersion: { type: 'string' },
      },
    },
  },
};

export async function consultOpus(req: ConsultRequest): Promise<SeniorReviewResponse> {
  try {
    const result = await Promise.race([
      anthropicProvider.generate({
        provider: 'anthropic',
        model: req.modelId,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildStageTurn(req.stage, req.payload) }],
        tools: [RETURN_REVIEW_TOOL],
        temperature: 0,
        maxTokens: 2048,
      }),
      timeoutPromise(req.timeoutMs),
    ]);

    const toolCall = result.toolCalls?.find((tc) => tc.name === 'return_review');
    if (!toolCall) {
      throw new MalformedResponseError('backend returned no return_review tool call');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(toolCall.arguments);
    } catch {
      throw new MalformedResponseError('tool_use arguments are not valid JSON');
    }

    const validation = seniorReviewResponseSchema.safeParse(parsed);
    if (!validation.success) {
      throw new MalformedResponseError(`response failed schema validation: ${validation.error.message}`);
    }
    return validation.data;
  } catch (err) {
    if (err instanceof MalformedResponseError) throw err;
    throw classifyProviderError(err);
  }
}

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new TimeoutError(`backend timed out after ${ms}ms`)), ms);
  });
}

function classifyProviderError(err: unknown): Error {
  if (err instanceof TimeoutError) return err;
  const e = err as { code?: string; status?: number; message?: string };
  if (e.code === 'ETIMEDOUT') return new TimeoutError(e.message ?? 'timeout');
  if (e.status === 429) return new RateLimitError(e.message ?? 'rate limited');
  if (typeof e.status === 'number' && e.status >= 500) {
    return new GatewayDegradedError(e.message ?? `gateway ${e.status}`);
  }
  if (e.code === 'ECONNRESET' || e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
    return new NetworkError(e.message ?? 'network failure');
  }
  return new NetworkError(e.message ?? 'unknown backend failure');
}
```

- [ ] **Step 4: Run backend test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/backend-opus-gateway.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/senior-review/backend/opus-gateway.ts \
        app/tests/unit/senior-review/backend-opus-gateway.test.ts
git commit -m "feat(senior-review): Opus backend with typed error classification (PR 1 task 6)"
```

---

## Task 7: Audit persistence

**Files:**
- Create: `app/src/lib/ai/agent/senior-review/audit.ts`
- Test: `app/tests/unit/senior-review/audit.test.ts`

- [ ] **Step 1: Write the failing audit test**

Create `app/tests/unit/senior-review/audit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const withUserRLSMock = vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn({
  insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: 'review-id' }]) })) })),
  update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
}));

vi.mock('@/lib/db', () => ({
  withUserRLS: (...args: unknown[]) => withUserRLSMock(...(args as [string, (tx: unknown) => unknown])),
  db: {},
}));

import { createReview, recordAttempt, finalizeReview } from '@/lib/ai/agent/senior-review/audit';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';

describe('senior-review audit persistence', () => {
  beforeEach(() => { withUserRLSMock.mockClear(); });

  it('createReview wraps insert in withUserRLS with userId', async () => {
    const id = await createReview({
      userId: USER_ID,
      sessionId: SESSION_ID,
      stage: 'section_recovery',
      policyType: 'conditional',
      invokingMutation: 'saveSectionDraft',
      invokingToolResult: null,
      triggeredBy: ['validation_failures'],
      schemaVersion: 'v1',
      initialStatus: 'suppressed_budget',
    });
    expect(id).toBeTruthy();
    expect(withUserRLSMock).toHaveBeenCalledWith(USER_ID, expect.any(Function));
  });

  it('createReview returns the newly-created review id', async () => {
    const id = await createReview({
      userId: USER_ID,
      sessionId: SESSION_ID,
      stage: 'call_selection',
      policyType: 'mandatory',
      invokingMutation: 'setSelectedCall',
      invokingToolResult: null,
      triggeredBy: null,
      schemaVersion: 'v1',
      initialStatus: 'completed',
    });
    expect(typeof id).toBe('string');
  });

  it('recordAttempt wraps insert in withUserRLS with userId', async () => {
    await recordAttempt({
      userId: USER_ID,
      reviewId: REVIEW_ID,
      attemptIndex: 0,
      latencyMs: 1234,
      outcome: 'success',
    });
    expect(withUserRLSMock).toHaveBeenCalledWith(USER_ID, expect.any(Function));
  });

  it('finalizeReview wraps update in withUserRLS with userId', async () => {
    await finalizeReview({
      userId: USER_ID,
      reviewId: REVIEW_ID,
      status: 'completed',
      verdict: 'proceed',
      failureReason: null,
      totalAttempts: 1,
      totalLatencyMs: 1234,
      reviewSummary: 'all good',
    });
    expect(withUserRLSMock).toHaveBeenCalledWith(USER_ID, expect.any(Function));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/audit.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the audit module**

Create `app/src/lib/ai/agent/senior-review/audit.ts`:

```typescript
// Senior Review audit persistence. Two-level identity: one review row per
// logical consult event, one attempt row per backend call.
// All writes go through withUserRLS so the new RLS policies see the tenant.
// See spec §5.7, §9.

import { withUserRLS } from '@/lib/db';
import { agentSeniorReviews, agentSeniorReviewAttempts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type {
  Stage, PolicyType, ConsultStatus, ReviewVerdict, AttemptOutcome, FailureReason,
} from './types';

export interface CreateReviewArgs {
  userId: string;
  sessionId: string;
  stage: Stage;
  policyType: PolicyType;
  invokingMutation: string | null;
  invokingToolResult: string | null;
  triggeredBy: string[] | null;
  schemaVersion: string;
  initialStatus: ConsultStatus;
}

export async function createReview(args: CreateReviewArgs): Promise<string> {
  return withUserRLS(args.userId, async (tx) => {
    const [row] = await tx
      .insert(agentSeniorReviews)
      .values({
        sessionId: args.sessionId,
        stage: args.stage,
        policyType: args.policyType,
        invokingMutation: args.invokingMutation,
        invokingToolResult: args.invokingToolResult,
        triggeredBy: args.triggeredBy,
        status: args.initialStatus,
        schemaVersion: args.schemaVersion,
        totalAttempts: 0,
        totalLatencyMs: 0,
      })
      .returning({ id: agentSeniorReviews.id });
    return row.id;
  });
}

export interface RecordAttemptArgs {
  userId: string;
  reviewId: string;
  attemptIndex: number;
  latencyMs: number;
  outcome: AttemptOutcome;
}

export async function recordAttempt(args: RecordAttemptArgs): Promise<void> {
  await withUserRLS(args.userId, async (tx) => {
    await tx.insert(agentSeniorReviewAttempts).values({
      reviewId: args.reviewId,
      attemptIndex: args.attemptIndex,
      latencyMs: args.latencyMs,
      outcome: args.outcome,
    });
  });
}

export interface FinalizeReviewArgs {
  userId: string;
  reviewId: string;
  status: ConsultStatus;
  verdict: ReviewVerdict | null;
  failureReason: FailureReason | null;
  totalAttempts: number;
  totalLatencyMs: number;
  reviewSummary: string | null;
}

export async function finalizeReview(args: FinalizeReviewArgs): Promise<void> {
  await withUserRLS(args.userId, async (tx) => {
    await tx
      .update(agentSeniorReviews)
      .set({
        status: args.status,
        verdict: args.verdict,
        failureReason: args.failureReason,
        totalAttempts: args.totalAttempts,
        totalLatencyMs: args.totalLatencyMs,
        reviewSummary: args.reviewSummary,
      })
      .where(eq(agentSeniorReviews.id, args.reviewId));
  });
}
```

- [ ] **Step 4: Run audit test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/audit.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/senior-review/audit.ts \
        app/tests/unit/senior-review/audit.test.ts
git commit -m "feat(senior-review): audit persistence (PR 1 task 7)"
```

---

## Task 8: Budget accounting

**Files:**
- Create: `app/src/lib/ai/agent/senior-review/budget.ts`
- Test: `app/tests/unit/senior-review/budget.test.ts`

- [ ] **Step 1: Write the failing budget test**

Create `app/tests/unit/senior-review/budget.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

let currentCount = 0;
const withUserRLSMock = vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn({
  select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: currentCount }]) }) }),
}));

vi.mock('@/lib/db', () => ({
  withUserRLS: (...args: unknown[]) => withUserRLSMock(...(args as [string, (tx: unknown) => unknown])),
  db: {},
}));

import { checkConditionalBudget } from '@/lib/ai/agent/senior-review/budget';
import { BUDGET_CONFIG } from '@/lib/ai/agent/senior-review/config';

const USER_ID = '33333333-3333-4333-8333-333333333333';

describe('checkConditionalBudget', () => {
  beforeEach(() => { withUserRLSMock.mockClear(); });

  it('returns ok when count < soft cap', async () => {
    currentCount = 3;
    const r = await checkConditionalBudget({ userId: USER_ID, sessionId: 'sid' });
    expect(r).toEqual({ status: 'ok', currentCount: 3 });
    expect(withUserRLSMock).toHaveBeenCalledWith(USER_ID, expect.any(Function));
  });

  it('returns warning when count at soft cap boundary', async () => {
    currentCount = BUDGET_CONFIG.conditionalSoftCap;
    const r = await checkConditionalBudget({ userId: USER_ID, sessionId: 'sid' });
    expect(r.status).toBe('warning');
  });

  it('returns warning when count between soft and hard caps', async () => {
    currentCount = BUDGET_CONFIG.conditionalSoftCap + 1;
    const r = await checkConditionalBudget({ userId: USER_ID, sessionId: 'sid' });
    expect(r.status).toBe('warning');
  });

  it('returns suppressed when count reaches hard cap', async () => {
    currentCount = BUDGET_CONFIG.conditionalHardCap;
    const r = await checkConditionalBudget({ userId: USER_ID, sessionId: 'sid' });
    expect(r.status).toBe('suppressed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/budget.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write the budget module**

Create `app/src/lib/ai/agent/senior-review/budget.ts`:

```typescript
// Senior Review per-session budget accounting. Mandatory gates are not
// budgeted (they fire at most once per session each). Conditional gates
// respect soft (warn) and hard (suppress) caps.
// Reads go through withUserRLS so the new RLS policies see the tenant.
// See spec §5.5.

import { withUserRLS } from '@/lib/db';
import { agentSeniorReviews } from '@/lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { BUDGET_CONFIG } from './config';

export type BudgetStatus = 'ok' | 'warning' | 'suppressed';

export interface CheckBudgetArgs {
  userId: string;
  sessionId: string;
}

export interface BudgetCheckResult {
  status: BudgetStatus;
  currentCount: number;
}

const CONDITIONAL_STAGES = ['eligibility_verdict', 'section_recovery', 'contradiction_override'] as const;

export async function checkConditionalBudget(args: CheckBudgetArgs): Promise<BudgetCheckResult> {
  const currentCount = await withUserRLS(args.userId, async (tx) => {
    const rows = (await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(agentSeniorReviews)
      .where(and(
        eq(agentSeniorReviews.sessionId, args.sessionId),
        eq(agentSeniorReviews.policyType, 'conditional'),
        inArray(agentSeniorReviews.stage, CONDITIONAL_STAGES as unknown as string[]),
      ))) as Array<{ count: number }>;
    return rows[0]?.count ?? 0;
  });

  if (currentCount >= BUDGET_CONFIG.conditionalHardCap) return { status: 'suppressed', currentCount };
  if (currentCount >= BUDGET_CONFIG.conditionalSoftCap) return { status: 'warning', currentCount };
  return { status: 'ok', currentCount };
}
```

- [ ] **Step 4: Run budget test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/budget.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/senior-review/budget.ts \
        app/tests/unit/senior-review/budget.test.ts
git commit -m "feat(senior-review): conditional budget accounting (PR 1 task 8)"
```

---

## Task 9: Metrics registration + helpers

**Files:**
- Create: `app/src/lib/ai/agent/senior-review/metrics.ts`
- Modify: `app/src/lib/monitoring/metrics.ts` (import the senior-review registration at module load)
- Test: `app/tests/unit/senior-review/metrics.test.ts`

- [ ] **Step 1: Write the failing metrics test**

Create `app/tests/unit/senior-review/metrics.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { registerSeniorReviewMetrics, trackConsult, observeConsultLatency, trackRetryAttempt, trackBudgetEvent, trackDecisionChanged } from '@/lib/ai/agent/senior-review/metrics';
import { metrics } from '@/lib/monitoring/metrics';

beforeAll(() => { registerSeniorReviewMetrics(); });

describe('senior-review metrics', () => {
  it('registers all expected counters and histograms', () => {
    const out = metrics.toPrometheus();
    expect(out).toContain('senior_review_consults_total');
    expect(out).toContain('senior_review_consult_duration_ms');
    expect(out).toContain('senior_review_consult_attempts_total');
    expect(out).toContain('senior_review_retry_reason_total');
    expect(out).toContain('senior_review_malformed_responses_total');
    expect(out).toContain('senior_review_budget_events_total');
    expect(out).toContain('senior_review_gate_bypassed_total');
    expect(out).toContain('senior_review_gate_blocked_total');
    expect(out).toContain('senior_review_decision_changed_total');
    expect(out).toContain('senior_review_active_consults');
  });

  it('trackConsult increments the counter with labels', () => {
    trackConsult({ stage: 'call_selection', verdict: 'proceed', status: 'completed', policyType: 'mandatory' });
    const out = metrics.toPrometheus();
    expect(out).toMatch(/senior_review_consults_total\{[^}]*stage="call_selection"[^}]*\} 1/);
  });

  it('observeConsultLatency records into the histogram', () => {
    // The existing registry uses non-standard output format for histograms
    // (appends _count/_sum to the labels, not the metric name). We assert
    // only that the metric line contains stage label and some sample body —
    // exact output format is a Prometheus-library concern, not our spec.
    observeConsultLatency('outline_freeze', 2300);
    const out = metrics.toPrometheus();
    expect(out).toContain('senior_review_consult_duration_ms');
    expect(out).toContain('stage="outline_freeze"');
  });

  it('trackDecisionChanged emits expected change_type label', () => {
    trackDecisionChanged('call_selection', 'selected_call_swapped');
    const out = metrics.toPrometheus();
    expect(out).toMatch(/senior_review_decision_changed_total\{[^}]*change_type="selected_call_swapped"[^}]*\} 1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/metrics.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write the metrics module**

Create `app/src/lib/ai/agent/senior-review/metrics.ts`:

```typescript
// Senior Review Prometheus metrics registration + wrapper helpers.
// See spec §8.1.

import { metrics } from '@/lib/monitoring/metrics';
import type { Stage, PolicyType, ReviewVerdict, ConsultStatus, AttemptOutcome } from './types';

const LATENCY_BUCKETS_MS = [100, 250, 500, 1000, 2000, 4000, 7000, 10000, 15000, 21000];

let registered = false;

export function registerSeniorReviewMetrics(): void {
  if (registered) return;
  registered = true;
  metrics.counter('senior_review_consults_total', 'Total Senior Review consults by stage/verdict/status/policy');
  metrics.histogram('senior_review_consult_duration_ms', 'Senior Review consult duration in ms', LATENCY_BUCKETS_MS);
  metrics.counter('senior_review_consult_attempts_total', 'Senior Review consult attempts by stage/outcome');
  metrics.counter('senior_review_retry_reason_total', 'Senior Review retry reasons');
  metrics.counter('senior_review_malformed_responses_total', 'Malformed advisor responses by stage');
  metrics.counter('senior_review_budget_events_total', 'Budget warnings and suppressions by stage');
  metrics.counter('senior_review_gate_bypassed_total', 'Conditional gate fail-open bypasses by stage/reason');
  metrics.counter('senior_review_gate_blocked_total', 'Mandatory gate fail-closed blocks by stage/reason');
  metrics.counter('senior_review_decision_changed_total', 'Decisions changed by advisor by stage/change_type');
  metrics.gauge('senior_review_active_consults', 'In-flight Senior Review consults');
}

export function trackConsult(args: {
  stage: Stage;
  verdict: ReviewVerdict | 'none';
  status: ConsultStatus;
  policyType: PolicyType;
}): void {
  metrics.inc('senior_review_consults_total', {
    stage: args.stage,
    verdict: args.verdict,
    status: args.status,
    policy_type: args.policyType,
  });
}

export function observeConsultLatency(stage: Stage, latencyMs: number): void {
  metrics.observe('senior_review_consult_duration_ms', { stage }, latencyMs);
}

export function trackRetryAttempt(stage: Stage, outcome: AttemptOutcome): void {
  metrics.inc('senior_review_consult_attempts_total', { stage, outcome });
  if (outcome !== 'success') {
    metrics.inc('senior_review_retry_reason_total', { reason: outcome });
  }
  if (outcome === 'malformed_response') {
    metrics.inc('senior_review_malformed_responses_total', { stage });
  }
}

export function trackBudgetEvent(stage: Stage, kind: 'warning' | 'suppressed'): void {
  metrics.inc('senior_review_budget_events_total', { stage, kind });
}

export function trackGateBlocked(stage: Stage, reason: string): void {
  metrics.inc('senior_review_gate_blocked_total', { stage, reason });
}

export function trackGateBypassed(stage: Stage, reason: string): void {
  metrics.inc('senior_review_gate_bypassed_total', { stage, reason });
}

export type DecisionChangeType =
  | 'confidence_downgraded'
  | 'selected_call_swapped'
  | 'outline_modified'
  | 'draft_modified'
  | 'blocked';

export function trackDecisionChanged(stage: Stage, changeType: DecisionChangeType): void {
  metrics.inc('senior_review_decision_changed_total', { stage, change_type: changeType });
}

export function setActiveConsults(count: number): void {
  metrics.set('senior_review_active_consults', {}, count);
}

// Self-register on module load. Any import of this file guarantees metrics
// exist before scraping. Avoids a circular import that would otherwise go
// monitoring/metrics → senior-review/metrics → monitoring/metrics.
registerSeniorReviewMetrics();
```

Do **not** add a reverse import into `app/src/lib/monitoring/metrics.ts`. Registration fires whenever any senior-review source module is imported (which happens at the first call to `requestSeniorReview`, via `service.ts` → `metrics.ts`). For belt-and-braces eager registration during app boot, add the import to the existing instrumentation bootstrap — see Step 4.

- [ ] **Step 4: Add eager registration at app bootstrap**

Add to the top of `app/src/instrumentation.ts` (if present; otherwise skip — lazy registration via service import is sufficient):

```typescript
// Eagerly register Senior Review metrics so Prometheus scraping sees the
// zero-valued series before the first consult fires.
import '@/lib/ai/agent/senior-review/metrics';
```

This is a side-effect import. The module's self-registration runs once at bootstrap.

- [ ] **Step 5: Run metrics test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/metrics.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/agent/senior-review/metrics.ts \
        app/tests/unit/senior-review/metrics.test.ts
# Only include instrumentation.ts if it exists and you added the import there:
# git add app/src/instrumentation.ts
git commit -m "feat(senior-review): Prometheus metrics self-registration (PR 1 task 9)"
```

---

## Task 10: Feature flag seed migration

The two flag keys (`senior_review_enabled`, `senior_review_shadow_mode`) must exist as rows in the `feature_flags` table, both disabled by default. The existing feature-flag module (`lib/feature-flags`) reads from the DB and fails closed on unknown keys — so without seeded rows, flag checks return `false`, which is correct for "off". No migration is strictly required. However, we seed rows to make them admin-visible and tunable via the existing admin flag UI.

**Files:**
- Create: `app/drizzle/0026_senior_review_flags_seed.sql`
- Modify: `app/drizzle/meta/_journal.json`
- Test: (manual verification only — feature-flag reads are already covered by existing tests)

- [ ] **Step 1: Write the seed migration**

Create `app/drizzle/0026_senior_review_flags_seed.sql`:

```sql
-- PR 1: seed Senior Review feature flags (default disabled)
INSERT INTO "feature_flags" ("key", "enabled", "targeting")
  VALUES
    ('senior_review_enabled', false, NULL),
    ('senior_review_shadow_mode', false, NULL)
  ON CONFLICT ("key") DO NOTHING;
```

- [ ] **Step 2: Register the migration in the journal**

Append to `app/drizzle/meta/_journal.json`:

```json
    ,{
      "idx": 26,
      "version": "7",
      "when": 1776643260000,
      "tag": "0026_senior_review_flags_seed",
      "breakpoints": true
    }
```

- [ ] **Step 3: Verify the journal still parses**

```bash
cd app && node -e "JSON.parse(require('fs').readFileSync('drizzle/meta/_journal.json','utf8')); console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add app/drizzle/0026_senior_review_flags_seed.sql app/drizzle/meta/_journal.json
git commit -m "feat(senior-review): seed feature flags (default off) (PR 1 task 10)"
```

---

## Task 11: Core service — `requestSeniorReview()`

**Files:**
- Create: `app/src/lib/ai/agent/senior-review/service.ts`
- Test: `app/tests/unit/senior-review/service.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `app/tests/unit/senior-review/service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createReviewMock = vi.fn();
const recordAttemptMock = vi.fn();
const finalizeReviewMock = vi.fn();

vi.mock('@/lib/ai/agent/senior-review/audit', () => ({
  createReview: (...args: unknown[]) => createReviewMock(...args),
  recordAttempt: (...args: unknown[]) => recordAttemptMock(...args),
  finalizeReview: (...args: unknown[]) => finalizeReviewMock(...args),
}));

const budgetCheckMock = vi.fn();
vi.mock('@/lib/ai/agent/senior-review/budget', () => ({
  checkConditionalBudget: (...args: unknown[]) => budgetCheckMock(...args),
}));

const flagCheckMock = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => flagCheckMock(...args),
}));

import { requestSeniorReview } from '@/lib/ai/agent/senior-review/service';
import { createMockBackend } from './fixtures/mock-backend';
import { TimeoutError, RateLimitError, MalformedResponseError } from '@/lib/ai/agent/senior-review/types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const BASE_ARGS = {
  sessionId: SESSION_ID,
  userId: USER_ID,
  tier: 'pro' as const,
  invokingMutation: null as string | null,
  invokingToolResult: null as string | null,
  triggeredBy: null as string[] | null,
};

function defaultFlags() {
  // Default: enabled flag on, shadow off. Tests override as needed.
  flagCheckMock.mockImplementation(async (key: string) => key === 'senior_review_enabled');
}

describe('requestSeniorReview', () => {
  beforeEach(() => {
    createReviewMock.mockReset().mockResolvedValue('review-id');
    recordAttemptMock.mockReset().mockResolvedValue(undefined);
    finalizeReviewMock.mockReset().mockResolvedValue(undefined);
    budgetCheckMock.mockReset().mockResolvedValue({ status: 'ok', currentCount: 0 });
    flagCheckMock.mockReset();
    defaultFlags();
  });

  it('passes userId and tier into isFeatureEnabled for targeting', async () => {
    const backend = createMockBackend();
    backend.queueSuccess({ verdict: 'proceed', reasons: [], riskFlags: [], schemaVersion: 'v1' });
    await requestSeniorReview({
      ...BASE_ARGS, stage: 'contradiction_override', payload: {},
    }, { backend });
    expect(flagCheckMock).toHaveBeenCalledWith(
      'senior_review_enabled',
      { userId: USER_ID, tier: 'pro' },
    );
  });

  it('returns proceed verdict with auditRef on first-try success', async () => {
    const backend = createMockBackend();
    backend.queueSuccess({ verdict: 'proceed', reasons: [], riskFlags: [], schemaVersion: 'v1' });

    const review = await requestSeniorReview({
      ...BASE_ARGS,
      stage: 'contradiction_override',
      payload: { foo: 'bar' },
      invokingToolResult: 'run-eligibility',
      triggeredBy: ['test'],
    }, { backend });

    expect(review.verdict).toBe('proceed');
    expect(review.auditRef).toBe('review-id');
    expect(backend.callCount).toBe(1);
    expect(finalizeReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', userId: USER_ID,
    }));
  });

  it('retries once after a TimeoutError then succeeds on second attempt', async () => {
    const backend = createMockBackend();
    backend.queueError(new TimeoutError('t'));
    backend.queueSuccess({ verdict: 'proceed', reasons: [], riskFlags: [], schemaVersion: 'v1' });

    const review = await requestSeniorReview({
      ...BASE_ARGS, stage: 'contradiction_override', payload: {},
    }, { backend });

    expect(review.verdict).toBe('proceed');
    expect(backend.callCount).toBe(2);
  });

  it('mandatory gate returns failed_blocked status after all retries exhausted', async () => {
    const backend = createMockBackend();
    backend.queueError(new TimeoutError('t1'));
    backend.queueError(new TimeoutError('t2'));
    backend.queueError(new TimeoutError('t3'));

    const review = await requestSeniorReview({
      ...BASE_ARGS, stage: 'call_selection', payload: {},
      invokingMutation: 'setSelectedCall',
    }, { backend });

    expect(review.verdict).toBe('block');
    expect(backend.callCount).toBe(3);
    expect(finalizeReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed_blocked', failureReason: 'timeout',
    }));
  });

  it('conditional gate returns proceed with bypass after retries exhausted', async () => {
    const backend = createMockBackend();
    backend.queueError(new RateLimitError('r1'));
    backend.queueError(new RateLimitError('r2'));
    backend.queueError(new RateLimitError('r3'));

    const review = await requestSeniorReview({
      ...BASE_ARGS, stage: 'section_recovery', payload: {},
      invokingMutation: 'saveSectionDraft', triggeredBy: ['repeated_failure'],
    }, { backend });

    expect(review.verdict).toBe('proceed');
    expect(finalizeReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed_bypassed', failureReason: 'rate_limit',
    }));
  });

  it('MalformedResponseError fails terminally without retries', async () => {
    const backend = createMockBackend();
    backend.queueError(new MalformedResponseError('bad'));

    const review = await requestSeniorReview({
      ...BASE_ARGS, stage: 'call_selection', payload: {},
      invokingMutation: 'setSelectedCall',
    }, { backend });

    expect(review.verdict).toBe('block');
    expect(backend.callCount).toBe(1);
    expect(finalizeReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed_blocked', failureReason: 'malformed_response',
    }));
  });

  it('suppresses consult when conditional hard cap hit and returns proceed', async () => {
    budgetCheckMock.mockResolvedValue({ status: 'suppressed', currentCount: 12 });
    const backend = createMockBackend();

    const review = await requestSeniorReview({
      ...BASE_ARGS, stage: 'section_recovery', payload: {},
      invokingMutation: 'saveSectionDraft',
    }, { backend });

    expect(review.verdict).toBe('proceed');
    expect(backend.callCount).toBe(0);
    expect(createReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      initialStatus: 'suppressed_budget',
    }));
  });

  it('shadow mode: runs consult but returns proceed regardless of advisor verdict', async () => {
    flagCheckMock.mockImplementation(async (key: string) => key === 'senior_review_shadow_mode');
    const backend = createMockBackend();
    backend.queueSuccess({
      verdict: 'block',
      reasons: [{ ro: 'no', en: 'no' }],
      riskFlags: ['shadow_test'],
      schemaVersion: 'v1',
    });

    const review = await requestSeniorReview({
      ...BASE_ARGS, stage: 'call_selection', payload: {},
      invokingMutation: 'setSelectedCall',
    }, { backend });

    expect(review.verdict).toBe('proceed');
    expect(review.shadowMode).toBe(true);
    expect(backend.callCount).toBe(1);
  });

  it('disabled flag: skips consult entirely and returns proceed with null auditRef', async () => {
    flagCheckMock.mockResolvedValue(false);
    const backend = createMockBackend();

    const review = await requestSeniorReview({
      ...BASE_ARGS, stage: 'call_selection', payload: {},
      invokingMutation: 'setSelectedCall',
    }, { backend });

    expect(review.verdict).toBe('proceed');
    expect(review.auditRef).toBeNull();
    expect(backend.callCount).toBe(0);
    expect(createReviewMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/service.test.ts
```
Expected: FAIL — service module does not exist.

- [ ] **Step 3: Write the service module**

Create `app/src/lib/ai/agent/senior-review/service.ts`:

```typescript
// Senior Review core orchestrator. Owns retry loop, timeout, budget,
// shadow-mode handling, audit writes, metric emission.
// See spec §3.2, §5.4-§5.6, §7.

import { isFeatureEnabled } from '@/lib/feature-flags';
import { createReview, recordAttempt, finalizeReview } from './audit';
import { checkConditionalBudget } from './budget';
import { CURRENT_SCHEMA_VERSION, FEATURE_FLAG_KEYS, GATE_CONFIG, RETRY_CONFIG } from './config';
import {
  trackConsult, observeConsultLatency, trackRetryAttempt,
  trackBudgetEvent, trackGateBlocked, trackGateBypassed,
} from './metrics';
import { consultOpus } from './backend/opus-gateway';
import {
  isRetryableBackendError, MalformedResponseError,
} from './types';
import type {
  Stage, SeniorReview, BackendError, ConsultStatus, ReviewVerdict,
  AttemptOutcome, FailureReason, PolicyType,
} from './types';
import type { SeniorReviewResponse } from './schemas';

export interface SeniorReviewBackend {
  consult(req: {
    stage: Stage; payload: unknown; modelId: string; timeoutMs: number;
  }): Promise<SeniorReviewResponse>;
}

const defaultBackend: SeniorReviewBackend = { consult: consultOpus };

export interface RequestSeniorReviewArgs {
  stage: Stage;
  sessionId: string;
  userId: string;
  tier?: string;
  payload: unknown;
  invokingMutation: string | null;
  invokingToolResult: string | null;
  triggeredBy: string[] | null;
}

export interface RequestSeniorReviewOptions {
  backend?: SeniorReviewBackend;
}

function shadowProceed(auditRef: string): SeniorReview {
  return {
    verdict: 'proceed', reasons: [], riskFlags: [],
    auditRef, schemaVersion: CURRENT_SCHEMA_VERSION, shadowMode: true,
  };
}

function plainProceed(auditRef: string | null): SeniorReview {
  return {
    verdict: 'proceed', reasons: [], riskFlags: [],
    auditRef, schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

function failedBlock(auditRef: string, reason: FailureReason): SeniorReview {
  return {
    verdict: 'block',
    reasons: [{ ro: 'Revizuire senior indisponibilă — încercați din nou.', en: 'Senior review unavailable — please try again.' }],
    riskFlags: [`senior_review_${reason}`],
    auditRef, schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

function failedBypass(auditRef: string): SeniorReview {
  return {
    verdict: 'proceed', reasons: [], riskFlags: ['senior_review_bypassed'],
    auditRef, schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

export async function requestSeniorReview(
  args: RequestSeniorReviewArgs,
  options: RequestSeniorReviewOptions = {},
): Promise<SeniorReview> {
  const backend = options.backend ?? defaultBackend;
  const gate = GATE_CONFIG[args.stage];
  const policyType: PolicyType = gate.policyType;
  const flagCtx = { userId: args.userId, tier: args.tier };

  const [enabledOn, shadowOn] = await Promise.all([
    isFeatureEnabled(FEATURE_FLAG_KEYS.enabled, flagCtx),
    isFeatureEnabled(FEATURE_FLAG_KEYS.shadowMode, flagCtx),
  ]);

  // Disabled entirely. Return auditRef=null — no row was persisted.
  // Callers must treat null as "no audit linkage" (never persist as a FK).
  if (!enabledOn && !shadowOn) {
    return plainProceed(null);
  }

  // Conditional gate budget check (mandatory gates are not budgeted per spec §5.5).
  if (policyType === 'conditional') {
    const budget = await checkConditionalBudget({ userId: args.userId, sessionId: args.sessionId });
    if (budget.status === 'warning') trackBudgetEvent(args.stage, 'warning');
    if (budget.status === 'suppressed') {
      trackBudgetEvent(args.stage, 'suppressed');
      const reviewId = await createReview({
        userId: args.userId,
        sessionId: args.sessionId, stage: args.stage, policyType,
        invokingMutation: args.invokingMutation,
        invokingToolResult: args.invokingToolResult,
        triggeredBy: args.triggeredBy,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        initialStatus: 'suppressed_budget',
      });
      await finalizeReview({
        userId: args.userId,
        reviewId, status: 'suppressed_budget', verdict: null, failureReason: null,
        totalAttempts: 0, totalLatencyMs: 0, reviewSummary: null,
      });
      trackConsult({ stage: args.stage, verdict: 'none', status: 'suppressed_budget', policyType });
      return plainProceed(reviewId);
    }
  }

  // Create the review row in in-flight state before attempts.
  const reviewId = await createReview({
    userId: args.userId,
    sessionId: args.sessionId, stage: args.stage, policyType,
    invokingMutation: args.invokingMutation,
    invokingToolResult: args.invokingToolResult,
    triggeredBy: args.triggeredBy,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    initialStatus: 'completed', // tentatively; overwritten in finalize
  });

  // Retry loop.
  let totalLatency = 0;
  let attemptsUsed = 0;
  let lastError: BackendError | null = null;
  let response: SeniorReviewResponse | null = null;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
    attemptsUsed = attempt + 1;
    const start = Date.now();
    let outcome: AttemptOutcome;
    try {
      response = await backend.consult({
        stage: args.stage,
        payload: args.payload,
        modelId: gate.modelId,
        timeoutMs: RETRY_CONFIG.perAttemptTimeoutMs,
      });
      outcome = 'success';
    } catch (err) {
      outcome = (err as BackendError).outcome;
      lastError = err as BackendError;
    }
    const latency = Date.now() - start;
    totalLatency += latency;
    await recordAttempt({ userId: args.userId, reviewId, attemptIndex: attempt, latencyMs: latency, outcome });
    trackRetryAttempt(args.stage, outcome);

    if (outcome === 'success') break;
    if (lastError instanceof MalformedResponseError) break; // non-retryable
    if (!isRetryableBackendError(lastError)) break;
    if (attempt + 1 < RETRY_CONFIG.maxAttempts) {
      await wait(RETRY_CONFIG.backoffsMs[attempt] ?? 0);
    }
  }

  observeConsultLatency(args.stage, totalLatency);

  // Success path.
  if (response) {
    const actualVerdict: ReviewVerdict = response.verdict;
    await finalizeReview({
      userId: args.userId,
      reviewId, status: 'completed', verdict: actualVerdict, failureReason: null,
      totalAttempts: attemptsUsed, totalLatencyMs: totalLatency,
      reviewSummary: summariseResponse(response),
    });
    trackConsult({ stage: args.stage, verdict: actualVerdict, status: 'completed', policyType });

    // Shadow mode: persist real verdict, return neutral proceed.
    if (shadowOn && !enabledOn) return shadowProceed(reviewId);

    return {
      verdict: actualVerdict,
      reasons: response.reasons,
      riskFlags: response.riskFlags,
      modifiedInput: response.modifiedInput,
      advisoryNarrative: response.advisoryNarrative,
      rewriteStrategy: response.rewriteStrategy,
      auditRef: reviewId,
      schemaVersion: response.schemaVersion,
    };
  }

  // Failure path.
  const failureReason: FailureReason = (lastError?.outcome ?? 'network') as FailureReason;
  const status: ConsultStatus = policyType === 'mandatory' ? 'failed_blocked' : 'failed_bypassed';
  await finalizeReview({
    userId: args.userId,
    reviewId, status, verdict: null, failureReason,
    totalAttempts: attemptsUsed, totalLatencyMs: totalLatency,
    reviewSummary: null,
  });
  trackConsult({ stage: args.stage, verdict: 'none', status, policyType });
  if (status === 'failed_blocked') {
    trackGateBlocked(args.stage, failureReason);
    return failedBlock(reviewId, failureReason);
  }
  trackGateBypassed(args.stage, failureReason);
  return failedBypass(reviewId);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summariseResponse(response: SeniorReviewResponse): string {
  const reasonText = response.reasons.map((r) => r.en).join(' | ');
  return `${response.verdict}: ${reasonText}`.slice(0, 500);
}
```

- [ ] **Step 4: Run service test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/service.test.ts
```
Expected: PASS (all 8 test cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/senior-review/service.ts \
        app/tests/unit/senior-review/service.test.ts
git commit -m "feat(senior-review): requestSeniorReview orchestrator (PR 1 task 11)"
```

---

## Task 12: Gate helpers (no callers yet)

**Files:**
- Create: `app/src/lib/ai/agent/senior-review/gate.ts`
- Test: `app/tests/unit/senior-review/gate.test.ts`

- [ ] **Step 1: Write the failing gate test**

Create `app/tests/unit/senior-review/gate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const requestMock = vi.fn();
vi.mock('@/lib/ai/agent/senior-review/service', () => ({
  requestSeniorReview: (...args: unknown[]) => requestMock(...args),
}));

import { withSeniorReviewMutation, withSeniorReviewToolResult } from '@/lib/ai/agent/senior-review/gate';

const modifySchema = z.object({ selectedCallId: z.string(), confidenceClass: z.enum(['high', 'med', 'low']) });

const USER_ID = '33333333-3333-4333-8333-333333333333';
const BASE_MUTATION = {
  sessionId: 'sid',
  userId: USER_ID,
  tier: 'pro' as const,
  invokingMutation: 'setSelectedCall',
};
const BASE_TOOL = {
  sessionId: 'sid',
  userId: USER_ID,
  tier: 'pro' as const,
  invokingToolResult: 'run-eligibility',
};

describe('withSeniorReviewMutation', () => {
  beforeEach(() => requestMock.mockReset());

  it('forwards userId and tier to requestSeniorReview', async () => {
    requestMock.mockResolvedValue({
      verdict: 'proceed', reasons: [], riskFlags: [], auditRef: 'r1', schemaVersion: 'v1',
    });
    await withSeniorReviewMutation({
      ...BASE_MUTATION, stage: 'call_selection',
      candidate: { selectedCallId: 'c1', confidenceClass: 'high' as const },
      buildPayload: () => ({}), modifySchema,
    });
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID, tier: 'pro',
    }));
  });

  it('returns finalInput unchanged on proceed verdict', async () => {
    requestMock.mockResolvedValue({
      verdict: 'proceed', reasons: [], riskFlags: [], auditRef: 'r1', schemaVersion: 'v1',
    });
    const input = { selectedCallId: 'c1', confidenceClass: 'high' as const };
    const result = await withSeniorReviewMutation({
      ...BASE_MUTATION, stage: 'call_selection',
      candidate: input, buildPayload: () => ({ x: 1 }), modifySchema,
    });
    expect(result.finalInput).toEqual(input);
    expect(result.auditRef).toBe('r1');
  });

  it('returns modifiedInput when advisor returns modify and schema validates', async () => {
    requestMock.mockResolvedValue({
      verdict: 'modify',
      modifiedInput: { selectedCallId: 'c2', confidenceClass: 'med' },
      reasons: [{ ro: 'x', en: 'x' }], riskFlags: [], auditRef: 'r1', schemaVersion: 'v1',
    });
    const result = await withSeniorReviewMutation({
      ...BASE_MUTATION, stage: 'call_selection',
      candidate: { selectedCallId: 'c1', confidenceClass: 'high' as const },
      buildPayload: () => ({}), modifySchema,
    });
    expect(result.finalInput).toEqual({ selectedCallId: 'c2', confidenceClass: 'med' });
  });

  it('throws when advisor returns modify with input that fails stage schema', async () => {
    requestMock.mockResolvedValue({
      verdict: 'modify', modifiedInput: { selectedCallId: 'c2', confidenceClass: 'WRONG' },
      reasons: [], riskFlags: [], auditRef: 'r1', schemaVersion: 'v1',
    });
    await expect(withSeniorReviewMutation({
      ...BASE_MUTATION, stage: 'call_selection',
      candidate: { selectedCallId: 'c1', confidenceClass: 'high' as const },
      buildPayload: () => ({}), modifySchema,
    })).rejects.toThrow(/stage schema/i);
  });

  it('throws a block error on block verdict', async () => {
    requestMock.mockResolvedValue({
      verdict: 'block',
      reasons: [{ ro: 'motiv', en: 'reason' }],
      riskFlags: [], auditRef: 'r1', schemaVersion: 'v1',
    });
    await expect(withSeniorReviewMutation({
      ...BASE_MUTATION, stage: 'call_selection',
      candidate: { selectedCallId: 'c1', confidenceClass: 'high' as const },
      buildPayload: () => ({}), modifySchema,
    })).rejects.toThrow(/senior review blocked/i);
  });
});

describe('withSeniorReviewToolResult', () => {
  beforeEach(() => requestMock.mockReset());

  it('appends advisoryNarrative to the returned annotatedResult', async () => {
    requestMock.mockResolvedValue({
      verdict: 'proceed',
      reasons: [], riskFlags: [],
      advisoryNarrative: { ro: 'atent', en: 'cautious' },
      auditRef: 'r1', schemaVersion: 'v1',
    });
    const result = await withSeniorReviewToolResult({
      ...BASE_TOOL, stage: 'eligibility_verdict',
      toolResult: { eligible: 'ambiguous' },
      buildPayload: () => ({}),
      triggeredBy: ['ambiguous_criterion'],
    });
    expect(result.annotatedResult.eligible).toBe('ambiguous');
    expect(result.annotatedResult.advisoryNarrative).toEqual({ ro: 'atent', en: 'cautious' });
  });

  it('does not throw on block — conditional gate fail-open semantics apply', async () => {
    requestMock.mockResolvedValue({
      verdict: 'block', reasons: [{ ro: 'no', en: 'no' }],
      riskFlags: [], auditRef: 'r1', schemaVersion: 'v1',
    });
    const result = await withSeniorReviewToolResult({
      ...BASE_TOOL, stage: 'eligibility_verdict',
      toolResult: { eligible: false }, buildPayload: () => ({}),
      triggeredBy: null,
    });
    expect(result.annotatedResult).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/senior-review/gate.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write the gate helper module**

Create `app/src/lib/ai/agent/senior-review/gate.ts`:

```typescript
// Gate helpers for Senior Review integration points.
// - withSeniorReviewMutation: used inside service-layer mutation functions
//   (call_selection, outline_freeze, section_recovery).
// - withSeniorReviewToolResult: used inside the MCP tool dispatcher for
//   eligibility_verdict.
// No callers in PR 1. PR 2 wires the first caller.
// See spec §3.3, §3.4, §4.

import type { ZodSchema } from 'zod';
import { requestSeniorReview } from './service';
import type { Stage, SeniorReview } from './types';

export class SeniorReviewBlockedError extends Error {
  constructor(public readonly reasons: { ro: string; en: string }[], public readonly auditRef: string | null) {
    super(`senior review blocked: ${reasons.map((r) => r.en).join('; ')}`);
  }
}

export class SeniorReviewModifyInvalidError extends Error {
  constructor(message: string) { super(`modifiedInput failed stage schema: ${message}`); }
}

export interface MutationGateArgs<Input, Modify extends Input = Input> {
  stage: Exclude<Stage, 'contradiction_override' | 'eligibility_verdict'>;
  sessionId: string;
  userId: string;
  tier?: string;
  candidate: Input;
  buildPayload: (input: Input) => unknown;
  modifySchema: ZodSchema<Modify>;
  invokingMutation: string;
  triggeredBy?: string[] | null;
}

export interface MutationGateResult<Input> {
  finalInput: Input;
  auditRef: string | null;
  review: SeniorReview;
}

export async function withSeniorReviewMutation<Input, Modify extends Input = Input>(
  args: MutationGateArgs<Input, Modify>,
): Promise<MutationGateResult<Input>> {
  const review = await requestSeniorReview({
    stage: args.stage,
    sessionId: args.sessionId,
    userId: args.userId,
    tier: args.tier,
    payload: args.buildPayload(args.candidate),
    invokingMutation: args.invokingMutation,
    invokingToolResult: null,
    triggeredBy: args.triggeredBy ?? null,
  });

  if (review.verdict === 'block') {
    throw new SeniorReviewBlockedError(review.reasons, review.auditRef);
  }

  if (review.verdict === 'modify') {
    const parsed = args.modifySchema.safeParse(review.modifiedInput);
    if (!parsed.success) {
      throw new SeniorReviewModifyInvalidError(parsed.error.message);
    }
    return { finalInput: parsed.data as Input, auditRef: review.auditRef, review };
  }

  return { finalInput: args.candidate, auditRef: review.auditRef, review };
}

export interface ToolResultGateArgs<T extends object> {
  stage: Extract<Stage, 'eligibility_verdict'>;
  sessionId: string;
  userId: string;
  tier?: string;
  toolResult: T;
  buildPayload: (result: T) => unknown;
  invokingToolResult: string;
  triggeredBy: string[] | null;
}

export interface ToolResultGateResult<T extends object> {
  annotatedResult: T & { advisoryNarrative?: { ro: string; en: string } };
  auditRef: string | null;
  review: SeniorReview;
}

export async function withSeniorReviewToolResult<T extends object>(
  args: ToolResultGateArgs<T>,
): Promise<ToolResultGateResult<T>> {
  const review = await requestSeniorReview({
    stage: args.stage,
    sessionId: args.sessionId,
    userId: args.userId,
    tier: args.tier,
    payload: args.buildPayload(args.toolResult),
    invokingMutation: null,
    invokingToolResult: args.invokingToolResult,
    triggeredBy: args.triggeredBy,
  });

  // Gate 3 is fail-open by construction. Block verdict does NOT throw —
  // cautionary narrative still annotates the tool result.
  const annotated = {
    ...args.toolResult,
    ...(review.advisoryNarrative ? { advisoryNarrative: review.advisoryNarrative } : {}),
  };
  return { annotatedResult: annotated, auditRef: review.auditRef, review };
}
```

- [ ] **Step 4: Run gate test to verify pass**

```bash
cd app && npx vitest run tests/unit/senior-review/gate.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/senior-review/gate.ts \
        app/tests/unit/senior-review/gate.test.ts
git commit -m "feat(senior-review): gate helpers (no callers yet) (PR 1 task 12)"
```

---

## Task 13: Final verification — typecheck, lint, full test run

- [ ] **Step 1: Typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 2: Lint**

```bash
cd app && npm run lint
```
Expected: no new warnings for files under `senior-review/`.

- [ ] **Step 3: Run the full senior-review test suite**

```bash
cd app && npx vitest run tests/unit/senior-review/
```
Expected: all tests pass. Expected test file count: 9 (schema, schemas, config, prompts, fixtures/mock-backend, backend-opus-gateway, audit, budget, metrics, service, gate — some combined).

- [ ] **Step 4: Run the full project test suite to verify no regressions**

```bash
cd app && npm run test
```
Expected: no new failures. If any existing tests fail, investigate — do not proceed to DB migration application.

- [ ] **Step 5: Dry-run the migrations locally**

```bash
cd app && npm run db:push -- --dry-run 2>&1 | grep -E "0025|0026"
```
Expected: both migrations listed as pending.

Skip `db:migrate` against production until PR is ready to merge. Migrations apply as part of the normal deploy pipeline.

- [ ] **Step 6: Final commit if anything changed in Steps 1-5**

```bash
git status
# If any changes were needed to fix lint/typecheck:
# git add <files> && git commit -m "chore(senior-review): fix lint/typecheck (PR 1 task 13)"
```

---

## Out of scope for PR 1 (reminders)

These land in later PRs per spec §12:

- **PR 2:** First caller of `withSeniorReviewMutation()` via `setSelectedCall`. Call-selection payload builder, stage-specific response schema, call-selection dashboard panel.
- **PR 3:** `freezeOutline` integration. Outline-freeze payload builder + coverage pre-check + dashboard.
- **PR 4:** MCP tool dispatcher post-processor for `run-eligibility`/`score-fit`. First caller of `withSeniorReviewToolResult()`. Threshold evaluator, executor system prompt hardening, threshold-attribution dashboard.
- **PR 5:** `saveSectionDraft` recovery-path trigger. Contradiction override from validators. Cross-gate exit-criteria rollup dashboard.

PR 1 ships the primitive — nothing calls it. That is deliberate.
