# FondEU — Claude Managed Agents + MCP Architecture

> Claude owns orchestration and working context; EuFunds owns truth, rules, permissions, and side effects.

**Date:** 2026-04-09
**Status:** Draft — pending engineering review
**Supersedes:** Agent V3 runtime (`lib/ai/agent/runtime.ts`)
**Prerequisite:** V3 Session Inventory (merged to master, PR #10)
**Spec authors:** Human + Claude Opus 4.6

---

## 1. Goals / Non-goals

### Goals

1. **Offload orchestration** — Claude Managed Agent owns planning, tool sequencing, follow-ups, conversational continuity, and context curation. EuFunds stops maintaining a custom turn loop.
2. **Formal tool boundaries** — Every tool has a typed schema, a risk tier, and a domain owner. No tool crosses domains (reads don't write; rules don't persist).
3. **Session continuity** — Long-lived managed sessions that survive browser refreshes, interrupts, and partial completions. PostgreSQL remains source of truth for approved state.
4. **Graceful degradation** — V3 runtime stays as circuit-breaker fallback. Feature flag gates managed-agent routing per user/tier.
5. **Auditability** — Every write tool produces an audit event. Hash-chain integrity preserved.

### Non-goals

- **Replace Qdrant/RAG pipeline** — Evidence retrieval stays in EuFunds backend. Managed Agent calls it via MCP.
- **Multi-agent from day one** — Phase 5 (specialist agents) is out of scope until single-agent is stable.
- **Real-time collaboration** — One active session per application. No concurrent editing.
- **Custom model routing** — Managed Agent uses Anthropic's model. No per-section model routing (removes V3's critical/standard/supplementary split).
- **Migrate billing/rate-limiting into MCP** — Rate limits stay in the Next.js API layer.

---

## 2. Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  useAgent() hook → POST /api/ai/agent → SSE stream          │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js API Route  /api/ai/agent/route.ts                   │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Feature Flag │  │ Session      │  │ V3 Runtime        │  │
│  │ Router       │→ │ Manager      │  │ (fallback)        │  │
│  │ (managed vs  │  │ (create/     │  │                   │  │
│  │  v3)         │  │  resume/     │  │                   │  │
│  └─────────────┘  │  close)      │  └───────────────────┘  │
│                    └──────┬───────┘                          │
└───────────────────────────┼─────────────────────────────────┘
                            │
                   Anthropic Agent API
                            │
               ┌────────────▼────────────┐
               │  Claude Managed Agent    │
               │                          │
               │  System prompt           │
               │  + 4 skills              │
               │  + built-in web search   │
               │  + 4 MCP server configs  │
               └─────┬──┬──┬──┬──────────┘
                     │  │  │  │
          ┌──────────┘  │  │  └──────────┐
          ▼             ▼  ▼             ▼
  ┌──────────────┐ ┌─────────┐ ┌──────────────┐ ┌──────────────┐
  │ eufunds-read │ │eufunds- │ │ eufunds-write│ │eufunds-      │
  │              │ │rules    │ │              │ │research      │
  │ 9 tools      │ │ 5 tools │ │ 5 tools      │ │ 3 tools      │
  │ Risk: LOW    │ │Risk: LOW│ │ Risk: HIGH   │ │ Risk: MEDIUM │
  └──────┬───────┘ └────┬────┘ └──────┬───────┘ └──────┬───────┘
         │              │             │                 │
         ▼              ▼             ▼                 ▼
  ┌─────────────────────────────────────────────────────────┐
  │  EuFunds Backend                                         │
  │                                                          │
  │  PostgreSQL          Qdrant           External APIs      │
  │  (sessions,          (28K vectors,    (EurLex, CORDIS,   │
  │   sections,          eu_legislation)   funding portals)  │
  │   audit log)                                             │
  └─────────────────────────────────────────────────────────┘
```

### MCP server hosting

All 4 MCP servers run as Next.js API routes under `/api/mcp/` with HTTP+SSE transport. They share the same deployment and DB connection pool. This avoids separate infrastructure while maintaining logical separation.

```
/api/mcp/read/     → eufunds-read server
/api/mcp/rules/    → eufunds-rules server
/api/mcp/write/    → eufunds-write server
/api/mcp/research/ → eufunds-research server
```

---

## 3. Tool Contract Table

### eufunds-read (9 tools, risk: LOW)

All tools are non-destructive. No auth beyond session validation. No side effects.

| Tool | Input Schema | Output Schema | Guards |
|------|-------------|---------------|--------|
| `get_project_summary` | `{ projectId: uuid }` | `{ name, organizationType, sector, region, budgetRange, teamSize, description }` | Session must own project |
| `get_application_state` | `{ sessionId: uuid }` | `{ phase, selectedCallId, eligibility, outlineFrozen, sectionStatuses[], warnings[], stateVersion }` | Session owner match |
| `list_sections` | `{ sessionId: uuid }` | `{ sections: [{ key, title, status, documentOrder, lastUpdatedAt }] }` | Session owner match |
| `get_section` | `{ sessionId: uuid, sectionKey: string }` | `{ key, title, status, content, acceptedContent?, modelUsed, sourcesUsed[], versionCount }` | Session owner match |
| `search_calls` | `{ query: string, program?: string, maxResults?: number }` | `{ matches: [{ callId, title, program, deadline, score }] }` | None (public data) |
| `get_call_blueprint` | `{ callId: string }` | `{ callId, title, program, deadline, objectives, eligibilityCriteria[], requiredSections[], annexes[], budgetRules, structureConfidence }` | None |
| `retrieve_evidence` | `{ query: string, callId?: string, maxChunks?: number }` | `{ chunks: [{ content, sourceId, sourceTitle, score }] }` | None |
| `list_uploaded_documents` | `{ projectId: uuid }` | `{ documents: [{ id, filename, type, uploadedAt, sizeBytes }] }` | Project owner match |
| `get_validation_report` | `{ sessionId: uuid }` | `{ passed, issues[], summary: { accepted, draft, missing, total }, annexChecklist[] }` | Session owner match |

### eufunds-rules (5 tools, risk: LOW)

Deterministic evaluation. No LLM calls. No writes. Results are advisory — they inform the agent but don't mutate state.

| Tool | Input Schema | Output Schema | Guards |
|------|-------------|---------------|--------|
| `run_eligibility` | `{ projectSummary: ProjectSummary, callId: string }` | `{ eligible: bool, score: number, passes: Criterion[], failures: Criterion[], warnings: Criterion[] }` | None |
| `validate_section` | `{ sessionId: uuid, sectionKey: string }` | `{ valid: bool, issues: [{ type, message, severity }], score: number, recommendedStatus }` | Session owner match |
| `validate_application` | `{ sessionId: uuid }` | `{ passed: bool, issues[], summary: { accepted, draft, missing }, annexChecklist[] }` | Session owner match |
| `check_missing_annexes` | `{ sessionId: uuid }` | `{ required: string[], uploaded: string[], missing: string[] }` | Session owner match |
| `score_fit` | `{ projectSummary: ProjectSummary, callId: string }` | `{ overallScore: number, dimensions: [{ name, score, rationale }] }` | None |

### eufunds-write (5 tools, risk: HIGH)

Every tool produces an audit event. Optimistic concurrency via `stateVersion`. All writes are narrow and typed — no generic "update" tools.

| Tool | Input Schema | Output Schema | Guards |
|------|-------------|---------------|--------|
| `save_section_draft` | `{ sessionId: uuid, sectionKey: string, content: string, stateVersion: number }` | `{ saved: bool, versionNumber: number, newStateVersion: number }` | Session owner, outline frozen, eligibility passed, stateVersion match, policy gate (pre-generate) |
| `approve_revision` | `{ sessionId: uuid, sectionKey: string, stateVersion: number }` | `{ approved: bool, newStatus: 'accepted', newStateVersion: number }` | Session owner, section status = `needs_review`, stateVersion match |
| `rollback_section` | `{ sessionId: uuid, sectionKey: string, targetVersion: number, stateVersion: number }` | `{ rolledBack: bool, content: string, newStateVersion: number }` | Session owner, target version exists, stateVersion match |
| `set_application_status` | `{ sessionId: uuid, status: 'paused'\|'completed', stateVersion: number }` | `{ updated: bool, newStatus, newStateVersion: number }` | Session owner, stateVersion match. `completed` requires validate_application pass |
| `create_export_snapshot` | `{ sessionId: uuid }` | `{ snapshotId: uuid, format: 'json', downloadUrl: string, expiresAt: ISO8601 }` | Session owner, at least 1 accepted section |

### eufunds-research (3 tools, risk: MEDIUM)

External network calls. Results cached with TTL. May be slow (5-30s). Failures are non-fatal — agent continues with stale data.

| Tool | Input Schema | Output Schema | Guards |
|------|-------------|---------------|--------|
| `refresh_call_freshness` | `{ callId: string }` | `{ fresh: bool, lastCheckedAt: ISO8601, changes?: string[], newDeadline?: ISO8601 }` | None |
| `verify_deadline` | `{ callId: string }` | `{ deadline: ISO8601, daysRemaining: number, status: 'open'\|'closing_soon'\|'closed', source: string }` | None |
| `check_call_page_updates` | `{ callId: string, cachedBlueprintHash: string }` | `{ changed: bool, diff?: string[], newHash?: string }` | None |

---

## 4. Session Lifecycle

### States

```
                 create
                   │
                   ▼
              ┌─────────┐    resume     ┌─────────┐
              │  active  │◄────────────►│  paused  │
              └────┬─────┘              └──────────┘
                   │
          ┌────────┼────────┐
          ▼        ▼        ▼
    ┌──────────┐ ┌──────┐ ┌─────────┐
    │completed │ │error │ │abandoned│
    └──────────┘ └──────┘ └─────────┘
```

### Operations

**Create** — `POST /api/ai/agent` with no `sessionId`:
1. Auth check (requireAuth)
2. Feature flag check (`managed_agent_enabled` → managed path; else V3 fallback)
3. Create `application_agent_sessions` row with status `active`
4. Call Anthropic Agent API to create managed session with system prompt + MCP server configs
5. Store managed session ID in `application_agent_sessions.managedSessionId`
6. Return SSE stream

**Resume** — `POST /api/ai/agent` with `sessionId`:
1. Load `application_agent_sessions` row, verify ownership
2. Check `stateVersion` matches (409 if mismatch)
3. Resume managed session via Anthropic API
4. Inject fresh state summary into conversation turn
5. Return SSE stream

**Interrupt** — Client disconnects or sends abort signal:
1. Agent turn terminates gracefully (Anthropic handles mid-turn cleanup)
2. Any in-progress tool calls that completed persist their results
3. Session stays `active` — next resume picks up from last checkpoint

**Close** — Explicit user action or completion:
1. `set_application_status` tool sets status to `completed` or `paused`
2. `application_agent_sessions.status` updated
3. Managed session closed via Anthropic API
4. Audit event: `agent_session_closed`

**Degrade** — Anthropic API unreachable:
1. Circuit breaker opens after 3 consecutive failures (10s window)
2. Route handler falls back to V3 runtime
3. Session state loaded from PostgreSQL (shared schema)
4. User sees degraded-mode indicator in UI
5. Circuit breaker half-opens after 30s, probes with next request

### Session scoping

One active session per `(userId, projectId, selectedCallId)` tuple. Creating a new session for the same tuple pauses the existing one. This prevents state conflicts.

---

## 5. DB Schema Changes

### New table: `application_agent_sessions`

Maps EuFunds session state to Anthropic managed session IDs. Extends the existing `agent_sessions` table pattern.

```sql
CREATE TABLE application_agent_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  project_id      UUID REFERENCES projects(id),
  session_id      UUID NOT NULL REFERENCES agent_sessions(id),

  -- Managed Agent link
  managed_session_id  TEXT,           -- Anthropic's session ID (null = V3 mode)
  runtime_mode        TEXT NOT NULL DEFAULT 'v3'
                      CHECK (runtime_mode IN ('v3', 'managed')),

  -- Feature flag snapshot (which mode was active at creation)
  created_with_flag   BOOLEAN NOT NULL DEFAULT false,

  -- Lifecycle
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'paused', 'completed', 'abandoned', 'error')),
  degraded_at         TIMESTAMPTZ,    -- set when circuit breaker fired
  degraded_reason     TEXT,

  -- Metadata
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ,

  UNIQUE (user_id, project_id, managed_session_id)
);

CREATE INDEX idx_app_agent_sessions_user_status
  ON application_agent_sessions (user_id, status, updated_at DESC);

CREATE INDEX idx_app_agent_sessions_managed
  ON application_agent_sessions (managed_session_id)
  WHERE managed_session_id IS NOT NULL;
```

### Drizzle schema addition

```typescript
// In lib/db/schema.ts

export const runtimeModeEnum = pgEnum('runtime_mode', ['v3', 'managed'])

export const applicationAgentSessions = pgTable('application_agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  projectId: uuid('project_id').references(() => projects.id),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id),

  managedSessionId: text('managed_session_id'),
  runtimeMode: runtimeModeEnum('runtime_mode').notNull().default('v3'),
  createdWithFlag: boolean('created_with_flag').notNull().default(false),

  status: agentSessionStatusEnum('status').notNull().default('active'),
  degradedAt: timestamp('degraded_at', { withTimezone: true }),
  degradedReason: text('degraded_reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uq_app_agent_user_project_managed')
    .on(t.userId, t.projectId, t.managedSessionId),
  index('idx_app_agent_sessions_user_status')
    .on(t.userId, t.status, t.updatedAt),
])
```

### Existing tables — no changes

`agent_sessions`, `agent_sections`, `agent_section_versions`, `agent_messages`, `agent_checkpoints`, `session_knowledge` — all remain as-is. MCP tools read/write these tables through the same Drizzle queries the V3 runtime uses.

---

## 6. API Route Changes

### Feature-flagged routing in `/api/ai/agent/route.ts`

```typescript
export async function POST(req: Request) {
  const user = await requireAuth()
  const body = await parseAgentRequest(req)

  const useManagedAgent = await isFeatureEnabled('managed_agent_enabled', {
    userId: user.id,
    tier: user.tier,
  })

  if (useManagedAgent) {
    return handleManagedAgent(user, body)
  }

  // V3 fallback — existing runtime
  return handleV3Agent(user, body)
}
```

### `handleManagedAgent` flow

```typescript
async function handleManagedAgent(user: SessionUser, body: AgentRequest) {
  // 1. Load or create application_agent_sessions
  const appSession = body.sessionId
    ? await loadAppSession(body.sessionId, user.id)
    : await createAppSession(user.id, body.projectId)

  // 2. Check circuit breaker
  if (managedAgentCircuitBreaker.isOpen()) {
    // Degrade to V3
    await markDegraded(appSession.id, 'circuit_breaker_open')
    return handleV3Agent(user, body)
  }

  // 3. Build or resume managed session
  const managedSession = appSession.managedSessionId
    ? await resumeManagedSession(appSession.managedSessionId, body)
    : await createManagedSession(appSession, user, body)

  // 4. Stream events back to client (same SSE format as V3)
  return streamManagedAgentEvents(managedSession, appSession)
}
```

### SSE event contract — unchanged

The frontend `useAgent()` hook receives the same `AgentEvent` types regardless of runtime mode:

```typescript
type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; success: boolean; summary: string }
  | { type: 'phase_changed'; from: Phase; to: Phase }
  | { type: 'state_update'; patch: UIStateSnapshot }
  | { type: 'done'; finalState: UIStateSnapshot }
  | { type: 'error'; message: string; retryable: boolean }
```

The managed-agent event translator maps Anthropic's streaming events to these types.

### New routes for MCP servers

```
POST /api/mcp/read/     → MCP HTTP+SSE handler for eufunds-read
POST /api/mcp/rules/    → MCP HTTP+SSE handler for eufunds-rules
POST /api/mcp/write/    → MCP HTTP+SSE handler for eufunds-write
POST /api/mcp/research/ → MCP HTTP+SSE handler for eufunds-research
```

Each MCP route:
1. Validates the bearer token (Anthropic → EuFunds auth, see §11)
2. Parses the MCP tool call
3. Resolves the user context from the session
4. Executes the tool implementation (reuses V3 tool code)
5. Returns MCP-formatted result

---

## 7. Skills

Four custom skills define the agent's operational modes. Skills are instructions, not code — they shape how the agent sequences tools and reasons about results.

### 7.1 call-analysis

**Purpose:** Read and interpret funding call documents. Identify criteria, deadlines, annexes, ambiguity.

**When active:** Discovery and research phases.

**Behavior:**
- Search for calls matching the user's project profile
- When a call is selected, fetch the full blueprint
- Identify hard eligibility criteria vs. scoring criteria
- Flag ambiguous or contradictory requirements
- Summarize deadline, budget range, and required annexes
- Run eligibility check and present results with explanations

**Tool sequence:** `search_calls` → `get_call_blueprint` → `retrieve_evidence` → `run_eligibility`

### 7.2 section-drafting

**Purpose:** Draft evidence-grounded sections in the EuFunds application style.

**When active:** Drafting phase.

**Behavior:**
- Draft one section at a time in `generationOrder`
- For each section: retrieve relevant evidence, compose draft, validate, present for review
- Ground every claim in retrieved evidence — cite source IDs
- Match the call's required format (word limits, structure)
- After user feedback: regenerate with adjustments or accept

**Tool sequence:** `retrieve_evidence` → `save_section_draft` → `validate_section` → (user feedback) → repeat or `approve_revision`

### 7.3 review-and-gap-analysis

**Purpose:** Compare draft application against blueprint requirements. Flag gaps and weak claims.

**When active:** Review phase.

**Behavior:**
- Run `validate_application` to get overall status
- For each issue: explain what's missing and suggest how to address it
- Check annex completeness
- Verify deadline freshness before declaring ready
- Score overall application strength per dimension

**Tool sequence:** `validate_application` → `check_missing_annexes` → `verify_deadline` → `refresh_call_freshness` → per-section `validate_section`

### 7.4 evidence-discipline

**Purpose:** Hard constraint — never invent compliance facts, budgets, or eligibility claims.

**When active:** Always (cross-cutting).

**Behavior:**
- Every factual claim about eligibility, budget rules, or compliance must come from a tool result
- If evidence is insufficient, say so explicitly — never fill gaps with plausible-sounding content
- Budget figures must come from the call blueprint or user input, never generated
- Eligibility claims must come from `run_eligibility` results
- Deadlines must come from `verify_deadline` or `get_call_blueprint`

This skill is enforced in the system prompt as a hard rule, not a suggestion.

---

## 8. Context Strategy

### Default context (passed in every turn)

Injected into the managed agent's conversation context at session start and on each resume:

```
- application_agent_session.id
- agent_session.id (V3 session link)
- project.id + project.name
- selected_call_id (if any)
- current_phase
- stateVersion
- section_registry: [{ key, status, lastUpdatedAt }]  (compact — no content)
- active_warnings: [{ code, message, severity }]
- eligibility_summary: { eligible, score, failCount, warningCount }
- user_locale: 'ro' | 'en'
```

**Size:** ~500 tokens. Fits easily in system prompt.

### Just-in-time context (fetched via tools)

The agent calls MCP tools to fetch detailed data only when needed:

| Data | Tool | Why JIT |
|------|------|---------|
| Full call blueprint (objectives, criteria, sections, annexes) | `get_call_blueprint` | 2-5K tokens per blueprint |
| Evidence chunks from Qdrant | `retrieve_evidence` | Variable size, depends on query |
| Section content (markdown) | `get_section` | 1-10K tokens per section |
| Validation report (full issues list) | `get_validation_report` | Only needed in review phase |
| Annex checklist | `check_missing_annexes` | Only needed in review phase |
| Deadline freshness | `verify_deadline` | Only needed before completion |
| Project details | `get_project_summary` | Only on first turn or after long pause |

### Context refresh on resume

When a session resumes after a pause (>5 minutes), the route handler injects a **state refresh message** into the conversation:

```
[System] Session resumed. Current state:
- Phase: drafting
- Sections: 3/8 accepted, 1 in draft, 4 pending
- Last action: section "obiective-specifice" saved as draft (v2)
- Warnings: none
- Eligibility: passed (score: 87%)
```

This prevents the agent from operating on stale context without requiring a full tool call.

---

## 9. System Prompt

```
You are FondEU, an expert operator for Romanian EU funding applications (cereri de finanțare).

You help users prepare complete, submission-ready applications by analyzing calls, checking eligibility, drafting sections, and reviewing completeness.

## Your tools

You have access to 4 tool servers:
- **eufunds-read**: Query projects, sessions, sections, calls, evidence, documents. Use freely.
- **eufunds-rules**: Run eligibility checks, validate sections and applications, score fit. Results are deterministic — present them as facts.
- **eufunds-write**: Save drafts, approve revisions, rollback sections, set status, export. Every write is audited. Always confirm with the user before writing.
- **eufunds-research**: Check deadline freshness, verify call page updates. May be slow (5-30s). Results may be stale — say when data is cached.

## Hard rules

1. NEVER invent eligibility criteria, budget figures, compliance requirements, or deadlines. Every such claim must come from a tool result.
2. NEVER write a section draft without first retrieving evidence via `retrieve_evidence`. If evidence is insufficient, tell the user what's missing.
3. ALWAYS present structures, outlines, and eligibility results for user confirmation before proceeding to the next phase.
4. ALWAYS include source citations: "[Source: {sourceTitle}]" for every factual claim.
5. When you don't know something, say so. Suggest which tool could help.

## Workflow phases

1. **Discovery** — Understand the project. Ask about organization type, sector, region, budget, timeline.
2. **Research** — Search for matching calls. Present options. When user selects, resolve blueprint and run eligibility.
3. **Structuring** — Extract required sections from blueprint. Present outline for approval.
4. **Drafting** — Generate sections one at a time. After each: present for accept, regenerate, or skip.
5. **Review** — Validate full application. Show gaps, missing annexes, deadline status. Guide to completion.

## Communication style

- Speak Romanian by default. Switch to English if the user does.
- Be direct and specific. Users are professionals preparing real applications with real deadlines.
- Use structured output (tables, bullet lists) for criteria, sections, and validation results.
- Keep conversational turns focused — don't re-summarize what the user already knows.

## Current session state

{injected_state_block}
```

The `{injected_state_block}` is replaced at runtime with the default context from §8.

---

## 10. Failure Modes

### 10.1 Anthropic API outage

| Signal | Response |
|--------|----------|
| 3 consecutive 5xx or timeouts in 10s window | Circuit breaker opens |
| Circuit breaker open | Route handler falls back to V3 runtime |
| V3 fallback active | `application_agent_sessions.degradedAt` set, reason recorded |
| After 30s | Half-open: next request probes Anthropic API |
| Probe succeeds | Circuit breaker closes, new sessions use managed agent |

**User experience:** Seamless. Same SSE event format. UI shows "degraded mode" badge. No data loss — both runtimes share the same PostgreSQL state.

### 10.2 State divergence

**Risk:** Managed agent's conversational context disagrees with PostgreSQL truth.

| Scenario | Mitigation |
|----------|------------|
| Agent remembers old section status | Every `save_section_draft` and `approve_revision` returns fresh `newStateVersion`. Agent re-reads state via tools. |
| Stale blueprint after call update | `refresh_call_freshness` detects changes. `check_call_page_updates` diffs cached vs. live. System prompt warns when freshness is unknown. |
| Resume after long pause | State refresh message injected (§8). Agent can call `get_application_state` for full truth. |
| Concurrent browser tabs | Session scoping (§4) enforces one active session per tuple. Second tab gets 409. |

### 10.3 Stale context

**Risk:** Agent operates on outdated call data (deadline passed, criteria changed).

| Guard | Implementation |
|-------|---------------|
| Freshness confidence | Blueprint stores `freshnessConfidence`. Policy gate blocks completion if < 0.6. |
| `verify_deadline` | Called automatically in review phase. Returns `closed` status if deadline passed. |
| Refresh prompt | If `lastCheckedAt` > 24h, system prompt includes warning: "Call data may be stale. Consider refreshing." |

### 10.4 Write conflicts

**Risk:** Two tool calls attempt to modify the same section concurrently.

| Guard | Implementation |
|-------|---------------|
| Optimistic concurrency | Every write tool requires `stateVersion`. Mismatch → 409 with current version. |
| Sequential tool execution | Managed agent executes tools sequentially (Anthropic default). No parallel writes. |
| Upsert semantics | `save_section_draft` uses `ON CONFLICT (session_id, section_key)` — last write wins within a turn. |

### 10.5 MCP server errors

| Error type | Response |
|------------|----------|
| Individual tool timeout (>30s) | Tool returns `{ success: false, retryable: true }`. Agent can retry once. |
| MCP server 5xx | Tool returns error. Agent explains to user and suggests alternative action. |
| Auth failure (invalid token) | Tool returns 401. Session is corrupted — force close, create new session. |

---

## 11. Security

### 11.1 Auth: Anthropic → MCP servers

When Anthropic's managed agent calls EuFunds MCP tools, the request must be authenticated:

**Mechanism:** Bearer token in MCP request headers.

```
Authorization: Bearer {mcp_session_token}
```

**Token lifecycle:**
1. When EuFunds creates a managed session, it generates a signed JWT (`mcp_session_token`) containing `{ userId, sessionId, exp }`.
2. This token is passed to Anthropic as part of the MCP server configuration.
3. Each MCP route validates the token, extracts `userId`, and uses it for all permission checks.
4. Token TTL: 4 hours. Refresh on session resume.

**Signing:** HMAC-SHA256 with `MCP_TOKEN_SECRET` (env var, stored in Secret Manager).

### 11.2 Per-tenant enforcement

Every MCP tool that accesses user data performs ownership verification:

```typescript
// In every tool handler
const { userId, sessionId } = verifyMcpToken(req.headers.authorization)
const session = await db.query.agentSessions.findFirst({
  where: and(eq(agentSessions.id, input.sessionId), eq(agentSessions.userId, userId))
})
if (!session) throw Errors.forbidden()
```

RLS (`withUserRLS`) is NOT used for MCP tools — the MCP server already runs in a service context. Ownership checks are explicit in each tool handler.

### 11.3 Data governance

| Data type | Flows to Anthropic? | Mitigation |
|-----------|---------------------|------------|
| Project metadata (name, sector, region) | Yes — in system prompt context | Minimal PII. Org names are not personal data under GDPR. |
| Section content (drafts) | Yes — in conversation history | User-generated content. Same exposure as current V3 (Claude API). |
| Call/funding data | No — stays in MCP tool results | Tool results are processed by Claude but not stored by Anthropic beyond session. |
| User credentials / tokens | Never | Auth tokens stay in EuFunds backend. Only session references cross the boundary. |
| Audit log entries | Never | Audit log is write-only from MCP write tools. Never exposed as readable content. |
| Uploaded documents | Never | Documents stay in GCS/local storage. Only metadata exposed via `list_uploaded_documents`. |

**Data processing agreement:** Same coverage as existing Anthropic API usage. No additional DPA required for MCP — tools execute in EuFunds infrastructure and only tool results (structured JSON) cross to Anthropic.

### 11.4 Tool risk tiers

| Tier | Servers | Policy |
|------|---------|--------|
| LOW | eufunds-read, eufunds-rules | No confirmation needed. Agent calls freely. |
| MEDIUM | eufunds-research | No confirmation needed. Timeout handling required. Results flagged as potentially stale. |
| HIGH | eufunds-write | Agent must confirm with user before executing (enforced in system prompt). Audit event on every call. `stateVersion` required. |

---

## 12. Rollout Checklist

### Phase 1: Tool Extraction (2-3 weeks)

**Goal:** Refactor V3 tool implementations behind MCP-compatible interfaces. No agent changes.

**Deliverables:**
- [ ] MCP server scaffold (`/api/mcp/{read,rules,write,research}/route.ts`)
- [ ] MCP token generation and validation (`lib/mcp/auth.ts`)
- [ ] 22 tool handlers with typed input/output schemas (Zod → JSON Schema)
- [ ] Tool implementations extracted from V3 tool files (shared code, not duplicated)
- [ ] Integration tests: each tool callable via MCP HTTP transport
- [ ] `MCP_TOKEN_SECRET` added to Secret Manager and Cloud Build substitutions

**Success criteria:**
- All 22 tools return correct results via MCP HTTP calls
- V3 runtime unchanged and still functional
- Zero new dependencies (MCP SDK only)

### Phase 2: Read-Only Pilot (1-2 weeks)

**Goal:** Managed agent for understanding and retrieval only. No writes through managed path.

**Deliverables:**
- [ ] `managed_agent_enabled` feature flag (tier targeting: `enterprise` first)
- [ ] Agent definition with system prompt (§9) and read + rules MCP servers only
- [ ] `application_agent_sessions` table and Drizzle schema
- [ ] Feature-flagged routing in `/api/ai/agent/route.ts`
- [ ] Managed → SSE event translator (Anthropic events → `AgentEvent`)
- [ ] Circuit breaker with V3 fallback
- [ ] Session create / resume / interrupt flow

**Success criteria:**
- Enterprise users can search calls, get blueprints, run eligibility via managed agent
- Session survives browser refresh (resume works)
- Circuit breaker triggers on simulated outage, falls back to V3
- Same SSE event format — frontend `useAgent()` works without changes

### Phase 3: Section Drafting (2-3 weeks)

**Goal:** Enable write tools. Agent can draft, validate, and save sections.

**Deliverables:**
- [ ] eufunds-write MCP server enabled for managed sessions
- [ ] `save_section_draft`, `approve_revision`, `rollback_section` via MCP
- [ ] Optimistic concurrency enforcement in write tools
- [ ] Audit logging from MCP write tools (same `logAudit` calls)
- [ ] Quality comparison: managed agent drafts vs. V3 drafts (10 test applications)

**Success criteria:**
- End-to-end flow: discovery → research → structuring → drafting → review (manual sections only)
- Section versions created correctly
- Audit trail intact
- Draft quality >= V3 baseline (human evaluation, 10 test cases)

### Phase 4: Full Workspace (2-3 weeks)

**Goal:** Managed agent is the primary application workflow. V3 is fallback only.

**Deliverables:**
- [ ] All 4 MCP servers enabled
- [ ] eufunds-research tools connected
- [ ] `set_application_status` and `create_export_snapshot` implemented
- [ ] Feature flag expanded to `pro` tier
- [ ] Degraded-mode UI indicator
- [ ] Monitoring: managed vs. V3 usage metrics, error rates, latency percentiles

**Success criteria:**
- 80%+ of sessions complete via managed agent (no fallback)
- p95 latency <= 2x V3 baseline (MCP overhead acceptable)
- Zero data integrity issues (audit chain unbroken)
- User satisfaction >= V3 (qualitative feedback)

### Phase 5: Specialist Agents (future — out of scope)

**Goal:** Multiple managed agents for different roles (call analyst, reviewer, matching).

**Prerequisites:**
- Phase 4 stable for 4+ weeks
- Single-agent token usage and latency acceptable
- Clear use case where specialist outperforms generalist

**Not specified here.** Will require its own design spec.

---

## Appendix A: V3 → MCP Tool Mapping

| V3 Tool | MCP Server | MCP Tool | Notes |
|---------|------------|----------|-------|
| `search_calls` | eufunds-read | `search_calls` | Same interface |
| `resolve_call` | eufunds-read | `get_call_blueprint` | Renamed. Cache-first behavior preserved. |
| `get_call_blueprint` | eufunds-read | `get_call_blueprint` | Merged with resolve_call |
| `retrieve_call_evidence` | eufunds-read | `retrieve_evidence` | Renamed. Dropped `_call` prefix. |
| `refresh_call_freshness` | eufunds-research | `refresh_call_freshness` | Moved to research server (network call) |
| `run_eligibility` | eufunds-rules | `run_eligibility` | Same interface |
| `extract_structure` | eufunds-read | `get_call_blueprint` | Merged into blueprint. Structure is part of call data. |
| `generate_section` | eufunds-write | `save_section_draft` | Split: LLM generation stays in agent; MCP tool only saves. |
| `validate_section` | eufunds-rules | `validate_section` | Same interface |
| `validate_application` | eufunds-rules | `validate_application` | Same interface |
| `list_missing_annexes` | eufunds-rules | `check_missing_annexes` | Renamed |
| `regenerate_section` | eufunds-write | `save_section_draft` | Same tool, agent decides to overwrite |

## Appendix B: New tools (no V3 equivalent)

| MCP Tool | Server | Rationale |
|----------|--------|-----------|
| `get_project_summary` | eufunds-read | Agent needs project context without full DB query |
| `get_application_state` | eufunds-read | Replaces state injection in V3 runtime loop |
| `list_sections` | eufunds-read | Agent needs section registry without full content |
| `get_section` | eufunds-read | Agent reads individual sections on demand |
| `list_uploaded_documents` | eufunds-read | Annex verification needs document list |
| `get_validation_report` | eufunds-read | Read-only view of validation (vs. rules server which computes it) |
| `score_fit` | eufunds-rules | New capability: multi-dimensional project-call fit scoring |
| `approve_revision` | eufunds-write | Explicit approval action (was implicit in V3 structured actions) |
| `rollback_section` | eufunds-write | Exposed via V3 API but not as agent tool |
| `set_application_status` | eufunds-write | Explicit lifecycle management |
| `create_export_snapshot` | eufunds-write | New capability: downloadable application export |
| `verify_deadline` | eufunds-research | Dedicated deadline check (was part of freshness) |
| `check_call_page_updates` | eufunds-research | New: diff cached blueprint against live page |
