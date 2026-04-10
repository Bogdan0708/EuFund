# Phase 1 — MCP Tool Extraction

> Extract V3 agent tool business logic into framework-agnostic domain services.
> Expose those services through 4 logical MCP server domains. V3 runtime unchanged.

**Date:** 2026-04-09
**Status:** Final
**Parent spec:** `2026-04-09-managed-agents-architecture.md`
**Branch:** TBD (will branch from `master`)
**Spec authors:** Human + Claude Opus 4.6 (brainstorm session)

---

## 1. Goals

1. Extract business logic from V3 tool files into a shared service layer that neither V3 nor MCP types leak into.
2. Build 4 logical MCP server domains (read, rules, write, research) exposing 23 tools via the official MCP TypeScript SDK.
3. Implement MCP authentication aligned with the Managed Agents server-declaration + session-time auth/vault flow.
4. Verify V3 runtime passes all existing tests after refactoring tools to call services.
5. Prove the full pattern (service → MCP handler → HTTP transport → auth) with 2-3 representative tools before wiring all 23.

## 2. Non-goals

- No agent changes. V3 runtime loop, SSE streaming, and phase-gating remain untouched.
- No frontend changes. `useAgent()` hook is unaffected.
- No new feature flags. MCP endpoints exist but are not called by any agent until Phase 2.
- No Managed Agent session creation. Phase 1 only validates that MCP tools are callable via HTTP.

---

## 3. Layer Architecture

```
lib/ai/agent/
├── services/              ← NEW: framework-agnostic domain services
│   ├── types.ts           (ServiceContext, domain result types)
│   ├── errors.ts          (shared error taxonomy: NotFound, Authorization, Concurrency, Validation, ExternalDependency)
│   ├── blueprint.ts       (lookup cached blueprint, assemble extraction input, persist blueprint)
│   ├── evidence.ts        (vector search, ranking)
│   ├── eligibility.ts     (rule engine wrapper)
│   ├── sections.ts        (CRUD, versioning, validation)
│   ├── application.ts     (full-app validation, annex checks)
│   ├── freshness.ts       (deadline checks, page diffing)
│   └── projects.ts        (project summary, documents)
│
├── tools/                 ← EXISTING: V3 adapters (refactored to call services/)
│   └── (same files, thinner — delegate to services, wrap in ToolResult)
│
├── mcp/                   ← NEW: MCP adapters + infrastructure
│   ├── auth.ts            (JWT sign/verify for MCP tokens)
│   ├── server.ts          (McpServer factory + tool registration helpers)
│   ├── context.ts         (build ServiceContext from verified MCP token)
│   ├── read/              (9 tool handlers → CallToolResult)
│   │   ├── index.ts       (register all read tools on server)
│   │   ├── get-project-summary.ts
│   │   ├── get-application-state.ts
│   │   ├── list-sections.ts
│   │   ├── get-section.ts
│   │   ├── search-calls.ts
│   │   ├── get-call-blueprint.ts
│   │   ├── retrieve-evidence.ts
│   │   ├── list-uploaded-documents.ts
│   │   └── get-validation-report.ts
│   ├── rules/             (5 tool handlers)
│   │   ├── index.ts
│   │   ├── run-eligibility.ts
│   │   ├── validate-section.ts
│   │   ├── validate-application.ts
│   │   ├── check-missing-annexes.ts
│   │   └── score-fit.ts
│   ├── write/             (6 tool handlers)
│   │   ├── index.ts
│   │   ├── save-section-draft.ts
│   │   ├── approve-revision.ts
│   │   ├── rollback-section.ts
│   │   ├── set-application-status.ts
│   │   ├── create-export-snapshot.ts
│   │   └── save-call-blueprint.ts    ← NEW tool (option C)
│   └── research/          (3 tool handlers)
│       ├── index.ts
│       ├── refresh-call-freshness.ts
│       ├── verify-deadline.ts
│       └── check-call-page-updates.ts
│
app/api/mcp/
├── read/route.ts          ← Next.js route → eufunds-read domain
├── rules/route.ts         ← eufunds-rules domain
├── write/route.ts         ← eufunds-write domain
└── research/route.ts      ← eufunds-research domain
```

### Layer rules

| Layer | Imports from | Never imports |
|-------|-------------|---------------|
| `services/` | `lib/db`, `lib/vectors`, `lib/rules`, `lib/rag`, `lib/legal/audit` | `tools/`, `mcp/`, any V3 or MCP envelope types |
| `tools/` (V3 adapters) | `services/` | `mcp/` |
| `mcp/` (MCP adapters) | `services/` | `tools/` |
| `app/api/mcp/` | `mcp/` | `services/`, `tools/` |

Services are framework-agnostic domain functions. They perform DB queries, vector search, rule evaluation, and audit logging — they are not pure in the FP sense — but they have no knowledge of V3's `ToolResult` envelope or MCP's `CallToolResult` format.

---

## 4. ServiceContext

All service functions receive a `ServiceContext` as their first argument. This replaces scattered `userId` parameters and gives every service consistent access to identity, tenancy, and tracing.

```typescript
// services/types.ts

export interface ServiceContext {
  /** Authenticated user ID (from session or MCP token) */
  userId: string
  /** Agent session ID (from agent_sessions table) */
  sessionId?: string
  /** Organization ID — tenant boundary for ownership checks.
   *  Optional at the type level because V3 discovery phase may not have org context yet.
   *  Always present when built from MCP token (tenant always known).
   *  Services that need tenant scope MUST assert non-null at entry (see optionality policy). */
  organizationId?: string
  /** Project ID — scopes project-level queries.
   *  Optional because some tools (search_calls, run_eligibility) are project-independent.
   *  Services that need project scope MUST assert non-null at entry. */
  projectId?: string
  /** Request trace ID (for audit logging and observability) */
  requestId: string
  /** Request timestamp (avoids scattered Date.now() calls) */
  now: Date
}
```

### Building ServiceContext

**From V3 runtime** (in `tools/*.ts`):
```typescript
const ctx: ServiceContext = {
  userId: toolCtx.userId,
  sessionId: toolCtx.session.id,
  organizationId: toolCtx.session.organizationId,
  projectId: toolCtx.session.projectId,
  requestId: toolCtx.requestId,
  now: new Date(),
}
```

**From MCP token** (in `mcp/context.ts`):
```typescript
export function buildServiceContext(verified: VerifiedMcpToken, requestId: string): ServiceContext {
  return {
    userId: verified.userId,
    sessionId: verified.sessionId,
    organizationId: verified.organizationId,
    projectId: verified.projectId,
    requestId,
    now: new Date(),
  }
}
```

### Optionality policy

`organizationId` and `projectId` are optional in the type, but services must not silently ignore them when they are semantically required. The rule:

- **Services that operate on tenant-scoped data** (sections, application state, documents, write operations) MUST assert `ctx.organizationId` at their entry point. If missing, throw `AuthorizationError`.
- **Services that operate on project-scoped data** (project summary, uploaded documents) MUST assert `ctx.projectId`. If missing, throw `ValidationError`.
- **Services that operate on public data** (search_calls, run_eligibility, score_fit) MAY accept null org/project — these are genuinely project-independent.

This keeps the type honest (not every caller has tenant context) while preventing silent authorization gaps.

---

## 5. Error Taxonomy

Shared error types thrown by services. Both V3 and MCP adapters catch and map these consistently.

```typescript
// services/errors.ts

/** Base class for all service errors. */
export abstract class ServiceError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number
}

/** Resource not found (session, section, project, call). */
export class NotFoundError extends ServiceError {
  readonly code = 'NOT_FOUND'
  readonly httpStatus = 404
  constructor(public readonly resourceType: string, public readonly resourceId: string) {
    super(`${resourceType} not found: ${resourceId}`)
  }
}

/** Caller lacks permission for this operation. */
export class AuthorizationError extends ServiceError {
  readonly code = 'AUTHORIZATION'
  readonly httpStatus = 403
  constructor(message = 'Insufficient permissions') {
    super(message)
  }
}

/** Optimistic concurrency violation — stateVersion mismatch. */
export class ConcurrencyError extends ServiceError {
  readonly code = 'CONCURRENCY'
  readonly httpStatus = 409
  constructor(public readonly expected: number, public readonly actual: number) {
    super(`State version conflict: expected ${expected}, found ${actual}`)
  }
}

/** Input fails domain validation (bad section key, invalid status transition, etc.). */
export class ValidationError extends ServiceError {
  readonly code = 'VALIDATION'
  readonly httpStatus = 400
  constructor(public readonly field: string, message: string) {
    super(message)
  }
}

/** External dependency failed (Qdrant, Perplexity, funding portal scrape). */
export class ExternalDependencyError extends ServiceError {
  readonly code = 'EXTERNAL_DEPENDENCY'
  readonly httpStatus = 502
  constructor(public readonly service: string, public readonly retryable: boolean, message?: string) {
    super(message ?? `External service unavailable: ${service}`)
  }
}
```

### Adapter error mapping

| ServiceError | V3 ToolResult | MCP CallToolResult |
|-------------|--------------|-------------------|
| `NotFoundError` | `{ success: false, error: message, retryable: false }` | `{ isError: true, content: [{ type: 'text', text: message }] }` |
| `AuthorizationError` | `{ success: false, error: message, retryable: false }` | HTTP 403 before MCP processing |
| `ConcurrencyError` | `{ success: false, error: message, retryable: true }` | HTTP 409 with current stateVersion |
| `ValidationError` | `{ success: false, error: message, retryable: false }` | `{ isError: true, content: [{ type: 'text', text: message }] }` |
| `ExternalDependencyError` | `{ success: false, error: message, retryable: dep.retryable }` | `{ isError: true, content: [{ type: 'text', text: message }] }` |

---

## 6. Domain Result Types

Shared types returned by services. Both V3 and MCP adapters map from these to their respective envelopes.

```typescript
// services/types.ts

export interface BlueprintLookupResult {
  cached: boolean
  blueprint: CallBlueprint | null
  /** Present when cached=false — agent extracts structure from this */
  rawEvidence: EvidenceChunk[] | null
}

export interface EvidenceBundle {
  chunks: EvidenceChunk[]
  totalAvailable: number
  query: string
}

export interface EvidenceChunk {
  content: string
  sourceId: string
  sourceTitle: string
  score: number
  metadata: Record<string, unknown>
}

export interface EligibilityDecision {
  eligible: boolean
  score: number
  passes: EligibilityCriterion[]
  failures: EligibilityCriterion[]
  warnings: EligibilityCriterion[]
}

export interface EligibilityCriterion {
  rule: string
  message: string
  severity: 'pass' | 'fail' | 'warning'
}

export interface SectionDraftSaveResult {
  versionNumber: number
  sectionId: string
  newStateVersion: number
}

export interface SectionRollbackResult {
  content: string
  restoredVersion: number
  newStateVersion: number
}

export interface SectionValidationResult {
  valid: boolean
  issues: ValidationIssue[]
  score: number
  recommendedStatus: string
}

export interface ValidationIssue {
  type: string
  message: string
  severity: 'error' | 'warning' | 'info'
}

export interface ApplicationValidationResult {
  passed: boolean
  issues: ValidationIssue[]
  summary: {
    accepted: number
    draft: number
    missing: number
    total: number
  }
  annexChecklist: AnnexChecklistItem[]
}

export interface AnnexChecklistItem {
  name: string
  required: boolean
  uploaded: boolean
}

export interface FreshnessCheckResult {
  fresh: boolean
  lastCheckedAt: Date
  changes: string[] | null
  newDeadline: Date | null
}

export interface DeadlineVerification {
  deadline: Date
  daysRemaining: number
  status: 'open' | 'closing_soon' | 'closed'
  source: string
}

export interface CallPageDiff {
  changed: boolean
  diff: string[] | null
  newHash: string | null
}

export interface FitScore {
  overallScore: number
  dimensions: { name: string; score: number; rationale: string }[]
}

export interface ProjectSummary {
  name: string
  organizationType: string
  sector: string
  region: string
  budgetRange: string
  teamSize: number | null
  description: string
}

export interface ExportSnapshot {
  snapshotId: string
  format: 'json'
  downloadUrl: string
  expiresAt: Date
}

export interface BlueprintSaveResult {
  callId: string
  version: number
  contentHash: string
  persistedAt: Date
}
```

---

## 7. Service Signatures

### blueprint.ts

Three responsibilities aligned with option C:
- **Lookup cached blueprint** — cache-first retrieval
- **Assemble extraction input** — on cache miss, gather raw evidence for the agent to extract from
- **Persist blueprint** — save agent-extracted structure with provenance metadata

```typescript
export async function lookupBlueprint(ctx: ServiceContext, callId: string): Promise<BlueprintLookupResult>
export async function saveCallBlueprint(ctx: ServiceContext, callId: string, blueprint: CallBlueprint): Promise<BlueprintSaveResult>
```

`lookupBlueprint` is cache-first. On cache hit: `{ cached: true, blueprint, rawEvidence: null }`. On cache miss: `{ cached: false, blueprint: null, rawEvidence: [...] }`. Cache miss is a valid domain outcome, not a failure.

`saveCallBlueprint` returns `BlueprintSaveResult` with version, content hash, and timestamp — making the write path observable and testable.

### evidence.ts

```typescript
export async function searchCalls(ctx: ServiceContext, query: string, opts?: { program?: string; maxResults?: number }): Promise<{ matches: CallMatch[] }>
export async function retrieveEvidence(ctx: ServiceContext, query: string, opts?: { callId?: string; maxChunks?: number }): Promise<EvidenceBundle>
```

### eligibility.ts

```typescript
export async function runEligibility(ctx: ServiceContext, projectSummary: ProjectSummary, callId: string): Promise<EligibilityDecision>
export async function scoreFit(ctx: ServiceContext, projectSummary: ProjectSummary, callId: string): Promise<FitScore>
```

### sections.ts

```typescript
export async function listSections(ctx: ServiceContext, sessionId: string): Promise<SectionListItem[]>
export async function getSection(ctx: ServiceContext, sessionId: string, sectionKey: string): Promise<SectionDetail>
export async function saveSectionDraft(ctx: ServiceContext, input: {
  sessionId: string
  sectionKey: string
  content: string
  expectedStateVersion: number
}): Promise<SectionDraftSaveResult>
export async function approveSection(ctx: ServiceContext, input: {
  sessionId: string
  sectionKey: string
  expectedStateVersion: number
}): Promise<{ newStateVersion: number }>
export async function rollbackSection(ctx: ServiceContext, input: {
  sessionId: string
  sectionKey: string
  targetVersion: number
  expectedStateVersion: number
}): Promise<SectionRollbackResult>
export async function validateSection(ctx: ServiceContext, sessionId: string, sectionKey: string): Promise<SectionValidationResult>
```

All write operations take `expectedStateVersion`. Mismatch throws a `ConcurrencyError` (caught by adapters → 409 in MCP, `success: false, retryable: true` in V3).

### application.ts

```typescript
export async function validateApplication(ctx: ServiceContext, sessionId: string): Promise<ApplicationValidationResult>
export async function checkMissingAnnexes(ctx: ServiceContext, sessionId: string): Promise<{ required: string[]; uploaded: string[]; missing: string[] }>
export async function getApplicationState(ctx: ServiceContext, sessionId: string): Promise<ApplicationState>
export async function setApplicationStatus(ctx: ServiceContext, input: {
  sessionId: string
  status: 'paused' | 'completed'
  expectedStateVersion: number
}): Promise<{ newStateVersion: number }>
export async function createExportSnapshot(ctx: ServiceContext, sessionId: string): Promise<ExportSnapshot>
```

### freshness.ts

```typescript
export async function refreshCallFreshness(ctx: ServiceContext, callId: string): Promise<FreshnessCheckResult>
export async function verifyDeadline(ctx: ServiceContext, callId: string): Promise<DeadlineVerification>
export async function checkCallPageUpdates(ctx: ServiceContext, callId: string, cachedBlueprintHash: string): Promise<CallPageDiff>
```

### projects.ts

```typescript
export async function getProjectSummary(ctx: ServiceContext, projectId: string): Promise<ProjectSummary>
export async function listUploadedDocuments(ctx: ServiceContext, projectId: string): Promise<UploadedDocument[]>
```

---

## 8. MCP Auth

### Token structure

```typescript
interface McpTokenPayload {
  userId: string
  sessionId: string
  organizationId: string
  projectId?: string
  iat: number
  exp: number
}
```

**Signing:** HMAC-SHA256 with `MCP_TOKEN_SECRET` (env var, stored in Secret Manager).
**TTL:** 4 hours. Refreshed on session resume.

### Managed Agents integration

Anthropic's Managed Agents use a two-part MCP configuration:

1. **Agent definition** declares MCP servers by name and URL:
   ```json
   {
     "mcp_servers": [
       { "name": "eufunds-read", "url": "https://fondeu.../api/mcp/read/" },
       { "name": "eufunds-rules", "url": "https://fondeu.../api/mcp/rules/" },
       { "name": "eufunds-write", "url": "https://fondeu.../api/mcp/write/" },
       { "name": "eufunds-research", "url": "https://fondeu.../api/mcp/research/" }
     ]
   }
   ```

2. **Session creation** supplies auth for those servers via the auth/vault mechanism:
   - EuFunds mints a short-lived MCP JWT
   - EuFunds registers or references it via the auth/vault mechanism at session creation time
   - Anthropic calls the MCP server with that credential during the managed session

This separation ensures the bearer token is session-scoped, not embedded in static server config.

**Beta requirement:** Managed Agents currently require the `managed-agents-2026-04-01` beta header on API calls.

### MCP route auth handler

```typescript
// mcp/auth.ts

export function verifyMcpToken(authHeader: string | null): McpTokenPayload {
  if (!authHeader?.startsWith('Bearer ')) throw Errors.unauthorized()
  const token = authHeader.slice(7)
  try {
    return jwt.verify(token, process.env.MCP_TOKEN_SECRET!) as McpTokenPayload
  } catch {
    throw Errors.unauthorized()
  }
}

export function signMcpToken(payload: Omit<McpTokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, process.env.MCP_TOKEN_SECRET!, { expiresIn: '4h' })
}
```

---

## 9. MCP Server Setup

### Transport

Stateless. `sessionIdGenerator: undefined`. Each MCP tool call is an independent HTTP request authenticated by bearer token. No transport-level session tracking — all state lives in PostgreSQL.

### Server factory

```typescript
// mcp/server.ts

import { McpServer } from '@modelcontextprotocol/sdk/server'

export function createMcpDomain(name: string, version: string): McpServer {
  return new McpServer({ name, version })
}
```

Each logical domain gets its own `McpServer` instance. All 4 instances live in the same Next.js deployment — they are logical separations, not physical processes. The separation could be collapsed to fewer route mounts later without changing tool contracts.

### Route handler pattern

The server is created per-request with verified auth context passed at construction. Tool handlers close over the `ServiceContext` — no transport-level metadata needed.

```typescript
// app/api/mcp/read/route.ts

import { createReadServer } from '@/lib/ai/agent/mcp/read'
import { verifyMcpToken } from '@/lib/ai/agent/mcp/auth'
import { buildServiceContext } from '@/lib/ai/agent/mcp/context'

export async function POST(req: Request) {
  // Auth at HTTP layer, before MCP processing
  const verified = verifyMcpToken(req.headers.get('authorization'))
  const ctx = buildServiceContext(verified, crypto.randomUUID())

  // Server + tools created per-request, closing over auth context
  const { server, transport } = await createReadServer(ctx)
  return transport.handleRequest(req)
}
```

> **Note:** The exact MCP SDK transport API (import paths, `handleRequest` signature, server lifecycle) will be validated in Slice 1a. The patterns here are illustrative — the proving ground step exists precisely to lock down these details.

### Tool handler pattern

Tool handlers receive `ServiceContext` via closure, not via transport metadata:

```typescript
// mcp/read/search-calls.ts

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server'
import { searchCalls } from '../../services/evidence'
import type { ServiceContext } from '../../services/types'

export const searchCallsInput = z.object({
  query: z.string().min(1),
  program: z.string().optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
})

export function registerSearchCalls(server: McpServer, ctx: ServiceContext) {
  server.registerTool('search_calls', {
    title: 'Search Funding Calls',
    description: 'Search for EU funding calls matching a query. Returns ranked matches with scores.',
    inputSchema: searchCallsInput,
    annotations: { readOnlyHint: true },
  }, async (input) => {
    const result = await searchCalls(ctx, input.query, {
      program: input.program,
      maxResults: input.maxResults,
    })
    return {
      structuredContent: result,
      content: [{ type: 'text', text: `Found ${result.matches.length} matching calls.` }],
    }
  })
}
```

---

## 10. V3 Adapter Refactoring

### Pattern

V3 tool files become thin adapters. Business logic moves to services. `ToolResult` wrapping, state transitions, and checkpoints remain in V3.

**Before** (current `tools/search-calls.ts` — simplified):
```typescript
export const searchCallsTool: ToolDefinition = {
  name: 'search_calls',
  execute: async (input, toolCtx) => {
    const store = await getVectorStore()
    const hits = await store.search(input.query, input.maxResults ?? 10)
    // ... deduplication, scoring, filtering logic ...
    return {
      success: true,
      data: { matches },
      stateTransitions: matches.length > 0
        ? [{ type: 'SET_PHASE', payload: 'research' }]
        : [],
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}
```

**After** (refactored):
```typescript
export const searchCallsTool: ToolDefinition = {
  name: 'search_calls',
  execute: async (input, toolCtx) => {
    const start = Date.now()
    const ctx = buildServiceContextFromToolCtx(toolCtx)
    const result = await searchCalls(ctx, input.query, {
      program: input.program,
      maxResults: input.maxResults,
    })
    return {
      success: true,
      data: result,
      stateTransitions: result.matches.length > 0
        ? [{ type: 'SET_PHASE', payload: 'research' }]
        : [],
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}
```

### Cache miss semantics

For `get_call_blueprint` in V3, a cache miss is a valid domain outcome, not a failure:

```typescript
const result = await lookupBlueprint(ctx, input.callId)
return {
  success: true,  // cache miss is NOT a failure
  data: result,   // { cached: false, blueprint: null, rawEvidence: [...] }
  stateTransitions: result.cached
    ? [{ type: 'SET_BLUEPRINT', payload: result.blueprint }]
    : [],
  telemetry: { latencyMs: Date.now() - start },
}
```

V3 runtime handles the `cached: false` case by invoking `extract_structure` (existing LLM tool). In the managed agent future (Phase 2+), the agent handles extraction natively and calls `save_call_blueprint` to persist.

---

## 11. Implementation Order — Vertical Slices

### Shared foundation (before Slice 1)

1. `npm install @modelcontextprotocol/sdk`
2. Create `services/types.ts` — `ServiceContext` + all domain result types
3. Create `mcp/auth.ts` — `signMcpToken()` + `verifyMcpToken()`
4. Create `mcp/context.ts` — `buildServiceContext()`
5. Create `mcp/server.ts` — `createMcpDomain()` factory
6. Add `MCP_TOKEN_SECRET` to `.env.local` (dev) and Secret Manager (prod)

### Slice 1 — eufunds-read (proving ground → full server)

**Step 1a: Prove the pattern with 3 representative tools**

Pick tools that exercise different service dependencies:
- `search_calls` — vector store dependency
- `get_call_blueprint` — DB cache dependency + cache-miss domain outcome
- `get_application_state` — session ownership check

For each:
1. Extract business logic into `services/evidence.ts` and `services/blueprint.ts`
2. Refactor V3 tool to call service
3. Run existing V3 tests — must pass
4. Write MCP handler
5. Write adapter contract test (service result → `CallToolResult`)
6. Write MCP integration test (HTTP call → correct response + auth enforcement)

**Step 1b: Fill out remaining 6 read tools**

Once the pattern is proven, wire the remaining tools following the same structure:
- `get_project_summary` → `services/projects.ts`
- `list_sections`, `get_section` → `services/sections.ts`
- `retrieve_evidence` → `services/evidence.ts`
- `list_uploaded_documents` → `services/projects.ts`
- `get_validation_report` → `services/application.ts` (read-only view)

**Step 1c: API route**

Create `/api/mcp/read/route.ts` with auth + stateless transport.

### Slice 2 — eufunds-rules (5 tools)

1. Extract: `services/eligibility.ts`, `services/sections.ts` (validation), `services/application.ts` (validation)
2. Refactor V3 tools
3. Wire 5 MCP handlers
4. New tool: `score_fit` (no V3 equivalent — new service function)
5. Tests (service + adapter contract + MCP integration)
6. API route at `/api/mcp/rules/`

### Slice 3 — eufunds-research (3 tools)

1. Extract: `services/freshness.ts`
2. Refactor V3 `refresh-call-freshness.ts`
3. Wire 3 MCP handlers (2 new tools: `verify_deadline`, `check_call_page_updates`)
4. Tests
5. API route at `/api/mcp/research/`

### Slice 4 — eufunds-write (6 tools)

1. Extract: `services/sections.ts` (write operations with `expectedStateVersion` in signatures)
2. New tool: `save_call_blueprint` — service function + MCP handler
3. Wire 6 MCP handlers
4. Tests (extra coverage on concurrency, audit, and idempotency)
5. API route at `/api/mcp/write/`

**Write service contract.** Every write service function MUST, in order:

1. **Verify ownership** — assert `ctx.organizationId`, load session, confirm `session.userId === ctx.userId`
2. **Enforce `expectedStateVersion`** — compare against DB; throw `ConcurrencyError` on mismatch
3. **Persist mutation** — execute the write within a transaction
4. **Emit audit log** — call `logAudit()` with `ctx.requestId`, `ctx.userId`, action type, and affected resource ID
5. **Return canonical result** — include `newStateVersion` and any version/provenance metadata

This is a design contract, not an implementation suggestion. PR review should verify all 5 steps.

**Idempotency classification:**

| Write tool | Idempotent? | Notes |
|-----------|-------------|-------|
| `save_section_draft` | Yes | Upsert by `(sessionId, sectionKey)`. Repeated calls with same content produce same version. |
| `approve_revision` | Yes | If section is already `accepted`, returns current state without re-persisting. |
| `rollback_section` | Yes | Rolling back to the same version twice is a no-op (content already matches). |
| `save_call_blueprint` | Yes | Upsert by `callId`. Content hash in result allows caller to detect duplicates. |
| `set_application_status` | Yes | Setting status to current status is a no-op. |
| `create_export_snapshot` | **No** | Each call creates a new snapshot with a unique ID and download URL. Callers should not retry blindly — check for existing snapshot first via `get_application_state`. |

---

## 12. Test Strategy

### 4 test buckets

| Bucket | Scope | Count (approx.) | Location |
|--------|-------|-----------------|----------|
| **Service tests** | Each service function with mocked DB/Qdrant/external APIs | ~40-50 | `tests/unit/services/` |
| **Adapter contract tests** | V3 adapter maps service result → `ToolResult`; MCP adapter maps service result → `CallToolResult`. **Cover only highest-risk mappings** — tools with state transitions, error-to-status mapping, or non-trivial result reshaping. Do not test every tool; the goal is to lock down envelope translation for tools where drift would be dangerous, not to achieve adapter coverage. | ~15-20 | `tests/unit/adapters/` |
| **MCP integration tests** | Call MCP endpoint via HTTP, verify response shape + auth enforcement | ~25-30 | `tests/integration/mcp/` |
| **V3 regression** | Existing V3 tests pass after refactoring | existing | `tests/` (no changes) |

### Adapter contract test example

```typescript
describe('search_calls adapter contract', () => {
  const serviceResult: SearchCallsResult = {
    matches: [{ callId: 'CALL-1', title: 'Test', program: 'PNRR', deadline: '2026-12-01', score: 0.85 }]
  }

  it('V3 adapter wraps in ToolResult', () => {
    const toolResult = wrapSearchCallsForV3(serviceResult)
    expect(toolResult.success).toBe(true)
    expect(toolResult.data).toEqual(serviceResult)
    expect(toolResult.stateTransitions).toHaveLength(1) // SET_PHASE → research
  })

  it('MCP adapter wraps in CallToolResult', () => {
    const mcpResult = wrapSearchCallsForMcp(serviceResult)
    expect(mcpResult.structuredContent).toEqual(serviceResult)
    expect(mcpResult.content[0].text).toContain('1 matching')
  })
})
```

### MCP integration test example

```typescript
describe('POST /api/mcp/read/', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await fetch('/api/mcp/read/', { method: 'POST', body: mcpToolCall('search_calls', { query: 'test' }) })
    expect(res.status).toBe(401)
  })

  it('search_calls returns matches', async () => {
    const token = signMcpToken({ userId: TEST_USER_ID, sessionId: TEST_SESSION_ID, organizationId: TEST_ORG_ID })
    const res = await fetch('/api/mcp/read/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: mcpToolCall('search_calls', { query: 'renewable energy PNRR' }),
    })
    expect(res.status).toBe(200)
    const result = await parseMcpResult(res)
    expect(result.structuredContent.matches).toBeDefined()
  })
})
```

---

## 13. Dependencies

**New package:** `@modelcontextprotocol/sdk` — official MCP TypeScript SDK. Includes server, transport, and Streamable HTTP support. Add any runtime-specific helper package only if implementation actually requires it.

**New env var:** `MCP_TOKEN_SECRET` — HMAC-SHA256 signing key for MCP JWTs. Added to:
- `.env.local` (dev)
- Secret Manager (prod)
- `cloudbuild.production.yaml` substitutions

**No other new dependencies.** Zod (already in project) is used for all input schemas.

---

## 14. V3 → MCP Tool Mapping (updated)

| V3 Tool | MCP Domain | MCP Tool | Change |
|---------|-----------|----------|--------|
| `search_calls` | read | `search_calls` | Same interface |
| `resolve_call` | read | `get_call_blueprint` | Renamed. Returns `BlueprintLookupResult` (cache hit or raw evidence on miss) |
| `get_call_blueprint` | read | `get_call_blueprint` | Merged with resolve_call |
| `retrieve_call_evidence` | read | `retrieve_evidence` | Renamed |
| `refresh_call_freshness` | research | `refresh_call_freshness` | Moved to research domain |
| `run_eligibility` | rules | `run_eligibility` | Same interface |
| `extract_structure` | — | removed | Agent extracts natively; persists via `save_call_blueprint` |
| `generate_section` | write | `save_section_draft` | **Behavioral split, not 1:1 replacement.** V3 `generate_section` calls the LLM, formats output, and persists in one tool. In managed agent mode, the agent generates content natively and calls `save_section_draft` to persist only. Generation semantics (model routing, prompt construction, pattern injection) move from tool code into the agent's skills and system prompt. |
| `validate_section` | rules | `validate_section` | Same interface |
| `validate_application` | rules | `validate_application` | Same interface |
| `list_missing_annexes` | rules | `check_missing_annexes` | Renamed |
| `regenerate_section` | write | `save_section_draft` | Same tool, agent decides to overwrite |
| — | read | `get_project_summary` | New |
| — | read | `get_application_state` | New (replaces V3 state injection) |
| — | read | `list_sections` | New |
| — | read | `get_section` | New |
| — | read | `list_uploaded_documents` | New |
| — | read | `get_validation_report` | New (read-only view) |
| — | rules | `score_fit` | New |
| — | write | `approve_revision` | New (was V3 structured action) |
| — | write | `rollback_section` | New (was V3 API endpoint) |
| — | write | `set_application_status` | New |
| — | write | `create_export_snapshot` | New |
| — | write | `save_call_blueprint` | New (option C — agent-extracted blueprints) |
| — | research | `verify_deadline` | New |
| — | research | `check_call_page_updates` | New |

**Total: 23 MCP tools** (9 read + 5 rules + 6 write + 3 research)

---

## 15. Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Service extraction breaks V3 behavior | Medium | V3 regression tests run after each slice. Service functions tested independently. |
| MCP SDK incompatibility with Next.js App Router | Low | Validate in Slice 1a with 3 tools before committing to full extraction. |
| `@modelcontextprotocol/sdk` transport API differs from research | Low | Pin SDK version. Adjust handler pattern in foundation step. |
| Managed Agents beta API changes before Phase 2 | Low | Phase 1 only validates MCP tools via HTTP. Managed Agent integration deferred. |
| Service layer becomes a grab bag | Medium | Layer rules (§3) enforced in PR review. Services grouped by domain, not by tool. |
