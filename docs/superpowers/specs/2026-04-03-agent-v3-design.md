# FondEU Agent v3 — Design Specification

> Single conversational agent with typed tools, canonical state, and deterministic policies.
> Replaces the V2 5-step multi-agent pipeline.

**Date:** 2026-04-03
**Status:** Approved for implementation
**Branch:** TBD (will branch from `feature/local-production-readiness`)
**Spec authors:** Human + Claude Opus 4.6 (brainstorm session)

---

## 1. Architecture Overview

### Core Principle

One agent, strong tools, canonical state, deterministic policies.

```
┌─────────────────────────────────────────────────────┐
│  User (browser)                                      │
│  useAgent() hook ← streaming fetch() POST response  │
└──────────────┬──────────────────────────────────────┘
               │ POST /api/ai/agent
               ▼
┌─────────────────────────────────────────────────────┐
│  Agent Runtime (Next.js Route Handler)               │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Vercel   │  │ Message  │  │ Deterministic     │ │
│  │ AI SDK   │  │ History  │  │ Policies          │ │
│  │ (tools + │  │ Manager  │  │ (gates,           │ │
│  │ streaming)│  │          │  │  invariants,      │ │
│  └────┬─────┘  └──────────┘  │  invalidation)    │ │
│       │                       └───────────────────┘ │
│  ┌────▼──────────────────────────────────────────┐  │
│  │           Tool Registry                        │  │
│  │                                                │  │
│  │  READ         DECISION        GENERATION       │  │
│  │  search_calls  resolve_call   generate_section │  │
│  │  get_blueprint run_eligibility regen_section   │  │
│  │  retrieve_ev.  extract_struct.                 │  │
│  │  refresh_fresh validate_*                      │  │
│  │  list_annexes                                  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Telemetry / Event Log                         │  │
│  │  tool calls, model usage, retries, policy      │  │
│  │  violations, latency, token usage              │  │
│  └────────────────────────────────────────────────┘  │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  State Layer (PostgreSQL only)                       │
│                                                      │
│  agent_sessions  agent_sections  agent_checkpoints  │
│  agent_section_versions  agent_messages             │
│  call_knowledge  projects (final output)            │
└─────────────────────────────────────────────────────┘
```

### Five Invariant Rules

1. **Agent never owns facts** — facts come from tools and persisted state
2. **Every important tool call writes structured state** — via runtime-applied transitions
3. **Section generation stays a tool** — model-routable, not the conversation model
4. **Message history is first-class** — tool-call/result pairing preserved
5. **Framework code stays thin** — domain logic lives outside the route handler

### Why Single Agent

Based on Google Research "Towards a Science of Scaling Agent Systems" (180 configurations):
- Multi-agent degrades sequential tasks by 39-70%
- FondEU's workflow is sequential (each step depends on previous)
- FondEU's UX is interactive (user is the orchestrator)
- Tool-coordination overhead increases disproportionately with tool count
- Single agent = 1x error amplification vs 4.4x centralized, 17.2x independent

---

## 2. State Model & Persistence

### PostgreSQL as sole durable store

No Redis. In-memory buffer during single request, flush at checkpoints.

### agent_sessions

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `defaultRandom()` |
| userId | uuid FK → users | |
| status | varchar(20) | `active`, `paused`, `completed`, `abandoned`, `error` |
| locale | varchar(5) | `ro` / `en` |
| selectedCallId | varchar | null until call selected |
| currentPhase | varchar(20) | `discovery`, `research`, `structuring`, `drafting`, `review` |
| blueprint | jsonb | CallBlueprint (canonical, tool-written only) |
| eligibility | jsonb | EligibilityResult |
| outline | jsonb | approved SectionSpec[] |
| warnings | jsonb | active warnings array |
| planningArtifact | jsonb | `{projectSummary, keyAssumptions, openQuestions, generationOrder, unresolvedBlockers}` |
| messageSummary | text | compacted conversation summary (context, not truth) |
| stateVersion | integer | optimistic concurrency, default 0 |
| createdAt | timestamp | |
| updatedAt | timestamp | |

**Indexes:** `(userId, status, updatedAt)`, `(selectedCallId)`

**Phase is NOT `complete`** — use `status = 'completed'` instead. No overlap.

### agent_sections

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sessionId | uuid FK | |
| sectionKey | varchar | normalized ID |
| title | varchar | exact heading from extracted structure |
| documentOrder | integer | order in application form |
| generationOrder | integer | optimal generation sequence |
| status | varchar(20) | `pending`, `generating`, `draft`, `accepted`, `stale`, `invalidated`, `needs_review`, `failed` |
| content | text | current draft |
| acceptedContent | text | user-approved version |
| modelUsed | varchar | |
| retryCount | integer | default 0 |
| sourcesUsed | jsonb | provenance |
| promptVersion | varchar | |
| latencyMs | integer | |
| tokenUsage | jsonb | `{input, output}` |
| errorClass | varchar | nullable |
| updatedAt | timestamp | |

**Constraints:** `UNIQUE (sessionId, sectionKey)`
**Indexes:** `(sessionId, documentOrder)`, `(sessionId, status)`

### agent_section_versions

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sectionId | uuid FK | |
| versionNumber | integer | |
| kind | varchar(20) | `draft`, `accepted`, `regenerated`, `system_rewrite` |
| content | text | |
| modelUsed | varchar | |
| sourcesUsed | jsonb | |
| createdAt | timestamp | |

### agent_messages

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sessionId | uuid FK | |
| role | varchar(15) | `user`, `assistant`, `tool` |
| messageType | varchar(20) | `text`, `tool_call`, `tool_result`, `system_summary`, `structured_action` |
| content | jsonb | message content |
| toolName | varchar | nullable |
| toolCallId | varchar | nullable — pairs tool_call with tool_result |
| sequenceNumber | integer | monotonic per session |
| compactedAt | timestamp | nullable — set when compacted out of active context |
| createdAt | timestamp | |

**Indexes:** `(sessionId, sequenceNumber)`, `(sessionId, compactedAt)` for loading recent + uncompacted

### agent_checkpoints

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sessionId | uuid FK | |
| checkpointType | varchar(30) | `call_selected`, `structure_approved`, `section_accepted`, `section_regenerated`, `call_changed`, `structure_changed`, `proposal_completed` |
| payload | jsonb | snapshot of relevant state |
| createdAt | timestamp | |

**Index:** `(sessionId, createdAt)`

### call_knowledge (extended)

| Column | Type | Notes |
|---|---|---|
| callId | varchar PK | |
| program | varchar | |
| callTitle | varchar | |
| normalized | jsonb | full CallBlueprint |
| status | varchar(15) | `provisional`, `primed`, `verified` |
| extractedFrom | varchar(20) | `notebooklm`, `qdrant_obsidian`, `hybrid` |
| structureConfidence | real | 0.0-1.0 |
| freshnessConfidence | real | 0.0-1.0 |
| sourceDocs | jsonb | `{title, locator?, excerpt?}[]` |
| fieldProvenance | jsonb | `{sections?: source, annexes?: source, grid?: source, ...}` |
| contentExtractedAt | timestamp | when structure was normalized |
| freshnessCheckedAt | timestamp | when open/closed was verified |
| createdAt | timestamp | |
| updatedAt | timestamp | |

**Indexes:** `(program)`, `(contentExtractedAt)`, `(freshnessCheckedAt)`, `(status)`

### State Write Rules

State writes are runtime-controlled transitions, not agent-callable:

```
Tool result            → Runtime transition         → Checkpoint
─────────────────────────────────────────────────────────────────
resolve_call succeeds  → SET_BLUEPRINT,             → call_selected
                         SET_SELECTED_CALL
extract_structure done → SET_OUTLINE (provisional)  → (none until approved)
user approves outline  → FREEZE_OUTLINE             → structure_approved
generate_section done  → UPSERT_SECTION_DRAFT       → (none)
user accepts section   → ACCEPT_SECTION             → section_accepted
validate_application   → (gate only)                → proposal_completed
call changed           → INVALIDATE_ALL             → call_changed
outline changed        → MARK_SECTIONS_STALE        → structure_changed
```

**Checkpoints commit immediately** when triggered, not deferred to end-of-turn.

### Optimistic Concurrency

```sql
UPDATE agent_sessions SET ..., state_version = state_version + 1
WHERE id = $1 AND state_version = $2
```

Also per-section on `agent_sections` for independent section actions.

### Typed State Transitions

```typescript
type StateTransition =
  | { type: 'SET_SELECTED_CALL'; callId: string }
  | { type: 'SET_BLUEPRINT'; blueprint: CallBlueprint }
  | { type: 'SET_ELIGIBILITY'; result: EligibilityResult }
  | { type: 'SET_OUTLINE'; outline: SectionSpec[] }
  | { type: 'FREEZE_OUTLINE' }
  | { type: 'SET_PHASE'; phase: Phase }
  | { type: 'SET_WARNINGS'; warnings: Warning[] }
  | { type: 'ADD_WARNING'; warning: Warning }
  | { type: 'SET_PLANNING_ARTIFACT'; artifact: Partial<PlanningArtifact> }
  | { type: 'UPSERT_SECTION_DRAFT'; sectionKey: string; content: string; model: string; sources: string[] }
  | { type: 'ACCEPT_SECTION'; sectionKey: string }
  | { type: 'REJECT_SECTION'; sectionKey: string; reason: string }
  | { type: 'MARK_SECTION_STALE'; sectionKey: string }
  | { type: 'INVALIDATE_ALL_SECTIONS' }
  | { type: 'SET_STATUS'; status: SessionStatus }
```

---

## 3. Tool Registry & Categories

### Read Tools (safe, no side effects, always available)

| Tool | Input | Output | Source |
|---|---|---|---|
| `search_calls` | query, filters | matched calls[] | Qdrant + DB |
| `get_call_blueprint` | callId | CallBlueprint \| null | `call_knowledge` |
| `retrieve_call_evidence` | callId, query | evidence chunks[] | Qdrant + Obsidian (merged, type-priority ranked) |
| `refresh_call_freshness` | callTitle, program | `{isOpen, amendments, deadline}` | Perplexity (official sources only) |
| `list_missing_annexes` | sessionId | missing annexes[] | state + blueprint diff |

### Decision/Analysis Tools (produce canonical facts, runtime persists)

| Tool | Input | Output | Transitions |
|---|---|---|---|
| `resolve_call` | selectedCallId | CallBlueprint | → `SET_BLUEPRINT`, `SET_SELECTED_CALL`, checkpoint `call_selected` |
| `run_eligibility` | blueprint + project | EligibilityResult | → `SET_ELIGIBILITY` |
| `extract_structure` | blueprint + evidence | SectionSpec[] | → `SET_OUTLINE` (provisional until user approves) |
| `validate_section` | sectionKey, content, blueprint | issues[] + severity + recommended status | → (runtime updates section if issues) |
| `validate_application` | sessionId | pass/fail + blocking reasons | → **gate**: blocks completion |

### Generation Tools (expensive, model-routed)

| Tool | Input | Output | Transitions |
|---|---|---|---|
| `generate_section` | sectionKey, outline, blueprint, evidence | section content | → `UPSERT_SECTION_DRAFT`, creates version |
| `regenerate_section` | sectionKey, feedback | revised content | → new version, marks previous superseded |

### Model Routing

| Section type | Model | Notes |
|---|---|---|
| Critical (evaluationWeight >= 15) | Claude Opus 4.6 | Highest quality for scored sections |
| Standard | Claude Sonnet 4.6 | Good quality, lower cost |
| Budget/financial | GPT-5.4 | Strong numerical structure + deterministic validator |
| Regeneration | Same as original | Consistency; escalate after 2 failed validations |

### Tool Contract

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string
  category: 'read' | 'decision' | 'generation'
  description: string
  inputSchema: ZodSchema<TInput>
  execute: (input: TInput, ctx: ToolContext) => Promise<ToolResult<TOutput>>
  timeout: number
}

interface ToolContext {
  sessionId: string
  userId: string
  session: AgentSession
  sections: AgentSection[]
  stateVersion: number
  requestId: string
  db: DrizzleInstance
  logger: Logger
}

interface ToolResult<T> {
  success: boolean
  data?: T
  error?: string
  retryable?: boolean
  warnings?: string[]
  stateTransitions?: StateTransition[]
  checkpoint?: CheckpointRequest
  telemetry: {
    latencyMs: number
    tokensUsed?: { input: number; output: number }
    model?: string
    provider?: string
    sources?: string[]
    retryCount?: number
  }
}
```

### Deterministic Policy Gates

```
BEFORE generate_section:
  - outline MUST be approved (frozen)
  - eligibility MUST have run (no hard blockers)
  - structure_confidence >= 0.4
  - at least one evidence source OR explicit "low evidence" warning shown

BEFORE accept_section:
  - validate_section MUST have run for this section (unless explicitly low-risk)

BEFORE validate_application (completion):
  - ALL mandatory sections status = 'accepted'
  - No active eligibility blockers
  - Annexes checklist resolved
  - freshness_confidence >= 0.6 (freshness required for completion)

ON selectedCallId change:
  - INVALIDATE_ALL_SECTIONS
  - Clear blueprint, eligibility, outline
  - Checkpoint: call_changed

ON outline change:
  - Sections not in new outline → 'invalidated'
  - Sections with changed specs → 'stale'
  - Checkpoint: structure_changed

ON critical section accepted:
  - rezumat → 'stale' (must regenerate summary)
  - buget → 'stale' if budget-related section changed

ON freshness check finds corrigendum/amendment affecting structure:
  - Flag structure for immediate refresh (don't wait 30 days)

Per-tool timeouts:
  - Read tools: 15s
  - Decision tools: 30s
  - Generation tools: 120s
  - Max tool calls per turn: 10
  - Max retries per tool per turn: 3
```

---

## 4. Agent Runtime & Conversation Loop

### Transport

```
POST /api/ai/agent
  Body: { sessionId?, message?, action?: StructuredAction, requestId, locale }
  Response: streaming fetch() — NOT EventSource

GET /api/ai/agent/state?sessionId=...
  Response: canonical state snapshot (for reconnect reconciliation)
```

### Request Lifecycle

```
1. Persist user message/action immediately to agent_messages
2. Load session + sections + recent messages from DB
3. Check stateVersion (reject stale if action provided)
4. Check requestId idempotency (reject duplicate completed requests)
5. Build system prompt:
   a. Agent persona + locale
   b. Phase-aware tool list (read always available, decision/generation phase-gated)
   c. Canonical state snapshot (blueprint, eligibility, outline, section statuses, warnings)
   d. Planning artifact (assumptions, open questions, blockers)
6. Build message context:
   a. Compacted summary of older turns
   b. Recent N messages with tool-call/result pairs preserved
   c. Current user message/action
7. Call LLM (Opus 4.6) with tools
8. For each tool call:
   a. Check policy gates → reject with explanation if preconditions not met
   b. Execute tool (with timeout)
   c. Apply stateTransitions to in-memory buffer
   d. Commit checkpoint immediately if triggered
   e. Append tool_call + tool_result to agent_messages
   f. Stream progress events to client
   g. Feed tool result back to LLM
9. After LLM turn completes:
   a. Append assistant message to agent_messages
   b. Flush remaining in-memory state to DB
   c. Increment stateVersion
   d. Compact history if threshold reached
   e. Send 'done' event with final state snapshot
```

### Phase Transitions (runtime-detected)

| Condition | New phase |
|---|---|
| Sufficient project info gathered | `research` |
| selectedCallId + resolved blueprint | `structuring` |
| Outline approved (frozen) | `drafting` |
| All mandatory sections `accepted` | `review` |
| `validate_application` passes | `status = 'completed'` |

Agent can suggest transitions; runtime validates preconditions.

### Phase-Aware Tool Availability

| Phase | Primary tools | Always available |
|---|---|---|
| `discovery` | `search_calls` | All read tools |
| `research` | `resolve_call`, `retrieve_call_evidence`, `refresh_call_freshness`, `run_eligibility` | All read tools |
| `structuring` | `extract_structure`, `run_eligibility` | All read tools |
| `drafting` | `generate_section`, `validate_section`, `list_missing_annexes` | All read tools |
| `review` | `validate_application`, `regenerate_section`, `validate_section` | All read tools |

### Message History Management

- **Compaction trigger**: message count > 40 OR estimated tokens > 30K
- **Compaction method**: deterministic template extraction (key decisions, facts, approvals) + optional LLM summary for conversational nuance (never overrides canonical state)
- **Never compact**: tool-call/result pairs from current phase, user approval/rejection decisions
- **Store summary** in `agent_sessions.messageSummary` — helpful context only, not truth
- **Compacted messages**: get `compactedAt` timestamp, stay in DB for audit, not loaded into context

### Streaming Events (SSE over fetch)

```typescript
type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; summary: string; success: boolean }
  | { type: 'phase_changed'; from: string; to: string }
  | { type: 'section_status'; sectionKey: string; status: string }
  | { type: 'checkpoint'; checkpointType: string; summary: string }
  | { type: 'state_update'; patch: UIState }
  | { type: 'policy_violation'; gate: string; reason: string }
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'done'; finalState: UIStateSnapshot }

interface UIStateSnapshot {
  sessionId: string
  phase: string
  stateVersion: number
  warnings: Warning[]
  sections: UISectionSummary[]
  blueprint: CallBlueprint | null
  eligibility: EligibilityResult | null
}
```

### Error Handling

| Failure | Behavior |
|---|---|
| LLM call fails | Retry once. If fails again, send `error` event, session stays `active`. |
| Tool fails, `retryable: true` | Agent can re-invoke. Max 3 retries per tool per turn. |
| Tool fails, `retryable: false` | Agent sees error, explains to user, suggests alternative. |
| DB write fails | Retry once. If fails, `error` event. Next request reloads from DB. |
| Policy gate blocks | `policy_violation` event with explanation. Agent receives structured rejection. |
| Connection drops | Committed state at checkpoints is safe. GET `/state` reconciles on reconnect. |
| Committed state + later LLM failure | Committed state stays committed. Next turn resumes from DB truth. |
| Duplicate requestId | Return cached response or 409 Conflict. |

### Agent Persona

```
You are FondEU, an expert assistant for Romanian EU funding applications.
You help users prepare cereri de finanțare (funding applications).

RULES:
- Never invent facts. Use tools to retrieve information.
- Always cite which tool/source provided a fact.
- When you don't have enough information, say so and suggest research.
- Present section structures and eligibility results for confirmation.
- Speak Romanian by default, switch to English if user does.
- Be direct and specific. Users are professionals preparing real applications.
```

---

## 5. Knowledge Retrieval Strategy

### Runtime Retrieval Hierarchy

```
1. call_knowledge (canonical cached blueprint)
   ├── status = 'verified' or 'primed', confidence >= 0.6 → use as-is
   ├── status = 'provisional' or confidence < 0.6 → supplement with step 2
   └── not found → go to step 2

2. Qdrant + Obsidian (retrieve_call_evidence)
   ├── Qdrant: call title + program + call code
   │   Filter: ghid > anexa > cerere > corrigendum > legislation > summary
   │   Return: ranked evidence chunks with source metadata
   ├── Obsidian: program-specific notes
   │   Filter: program tag, call code in frontmatter
   │   Return: note excerpts with YAML metadata
   └── Merge: deduplicate, rank by relevance + type priority

3. Perplexity (refresh_call_freshness — freshness ONLY)
   ├── Check: open/closed, deadline changes, amendments, corrigenda
   ├── Source: official pages (mfe.gov.ro, mysmis2021.gov.ro, etc.)
   └── Return: grounded freshness facts with source URLs

4. NotebookLM (offline only — batch primer or admin refresh)
```

### call_knowledge Cache Lifecycle

**Population paths:**

| Path | Trigger | Initial status | Confidence |
|---|---|---|---|
| NotebookLM batch | `npm run prime-call-knowledge` | `primed` | 0.80-0.95 |
| Runtime synthesis | First user researches uncached call | `provisional` | 0.40-0.70 |
| Admin verification | Manual review of provisional | `verified` | 0.85-1.0 |

**Dual-clock refresh:**

| Clock | Max age | Checks |
|---|---|---|
| `contentExtractedAt` (structure) | 30 days | Structure, annexes, grid, eligibility |
| `freshnessCheckedAt` (status) | 24 hours | Open/closed, amendments, deadlines |

**Exception**: If freshness check discovers corrigendum affecting structure → flag structure for immediate refresh.

### Confidence Scoring

**Structure confidence** (coverage + quality + agreement):

| Signal | Points |
|---|---|
| >= 5 required sections extracted | +0.25 |
| >= 3 evaluation grid criteria | +0.20 |
| >= 2 mandatory annexes | +0.15 |
| Co-financing rate found | +0.10 |
| >= 3 eligibility criteria | +0.10 |
| Source = NotebookLM/verified | +0.10 |
| Exact call code match | +0.05 |
| Multiple sources agree on structure | +0.05 |

**Negative signals** (reduce confidence):
- Conflicting structures across sources: -0.15
- Only summary-derived, no primary guide: -0.10
- Weak document-title match: -0.05

**Freshness confidence** (time-decay):

| Age | Confidence |
|---|---|
| < 24h | 0.95 |
| 1-3 days | 0.80 |
| 3-7 days | 0.60 |
| 7-14 days | 0.40 |
| > 14 days | 0.20 |
| Never checked | 0.0 |

### Behavior Gating

| Structure | Freshness | Behavior |
|---|---|---|
| >= 0.6 | >= 0.6 | Full drafting + review allowed |
| >= 0.6 | < 0.6 | Drafting allowed, **completion blocked** until refreshed |
| 0.4-0.6 | any | Require explicit user confirmation of provisional structure |
| < 0.4 | any | Block auto-generation entirely |

### NotebookLM Batch Primer

Script: `app/scripts/prime-call-knowledge.ts`

```
For each program with a NotebookLM notebook:
  1. Get call IDs from Qdrant metadata (program + documentType = 'ghid')
  2. Get existing call_knowledge entries
  3. For each uncached or stale (> 30 days):
     a. Query NotebookLM via MCP
     b. Parse structured response
     c. Upsert call_knowledge (status = 'primed')
     d. Score confidence
  4. Report: primed N, skipped M cached, failed K, flagged L low-confidence
```

**Low-confidence review queue**: confidence < 0.7, missing sections/grid/annexes → flagged for manual review.

### Program-to-Notebook Mapping

Initially hardcoded, designed to become config:

```typescript
const PROGRAM_NOTEBOOK_MAP: Record<string, string> = {
  'PNRR': 'fondeu-pnrr',
  'PEO': 'fondeu-peo',
  'POTJ': 'fondeu-potj',
  'POAT': 'fondeu-poat',
  'POCIDIF': 'fondeu-pocidif',
  'PDD': 'fondeu-pdd',
  'PS': 'fondeu-ps',
  'POIM': 'fondeu-poim',
  'POCU': 'fondeu-pocu',
  'PoIDS': 'fondeu-poids',
  'PR-NE': 'fondeu-pr-ne',
  'PR-NV': 'fondeu-regional',
  'PR-BI': 'fondeu-regional',
  'PR-SM': 'fondeu-regional',
  'PR-SE': 'fondeu-regional',
  'PR-CENTRU': 'fondeu-regional',
  'PR-VEST': 'fondeu-regional',
  'PR-SV': 'fondeu-regional',
  'POCA': 'fondeu-other',
  'INTERREG': 'fondeu-other',
  'AFM': 'fondeu-other',
}
```

---

## 6. Frontend Integration

### Transport

- **Send**: streaming `fetch()` POST (not EventSource)
- **Reconnect**: GET `/api/ai/agent/state` for canonical state reconciliation
- **Client never optimistically updates canonical state**

### useAgent() Hook

```typescript
interface UseAgentReturn {
  sessionId: string | null
  phase: Phase
  stateVersion: number
  messages: UIMessage[]
  isStreaming: boolean
  blueprint: CallBlueprint | null
  eligibility: EligibilityResult | null
  outline: SectionSpec[] | null
  sections: UISection[]
  warnings: Warning[]
  lastError: AgentError | null
  activeTool: string | null
  pendingAction: StructuredAction | null
  canSend: boolean
  sendMessage: (text: string) => void
  sendAction: (action: StructuredAction) => void
  retryLast: () => void
}
```

### Structured Actions

```typescript
type StructuredAction =
  | { type: 'select_call'; callId: string }
  | { type: 'approve_outline' }
  | { type: 'accept_section'; sectionKey: string }
  | { type: 'regenerate_section'; sectionKey: string; feedback: string }
  | { type: 'reject_section'; sectionKey: string; reason: string }
  | { type: 'request_refresh' }
  | { type: 'mark_complete' }
```

Every submission includes `requestId` and `stateVersion`. Server rejects stale/duplicate.

### Page Layout

```
┌──────────────────────────────────────────────────────────┐
│  Header: FondEU — [Call title]  [Phase badge]             │
├──────────────────────────┬───────────────────────────────┤
│  Conversation (~45%)     │  Workspace (~55%)              │
│                          │                                │
│  [messages]              │  discovery: empty / call list  │
│  [tool indicators]       │  research: blueprint + elig.   │
│  [streaming text]        │  structuring: outline + approve│
│                          │  drafting: section cards       │
│                          │  review: validation checklist  │
│  ┌─────────────────────┐ │                                │
│  │ Input + action btns │ │                                │
│  └─────────────────────┘ │                                │
├──────────────────────────┴───────────────────────────────┤
│  Warnings bar                                             │
└──────────────────────────────────────────────────────────┘
```

Mobile: workspace becomes bottom sheet / tab.

### Connection Management

```typescript
// On disconnect: exponential backoff 1s, 2s, 4s... max 30s
// On reconnect: GET /api/ai/agent/state → reconcile
// Per-section: show local pending UI (spinner, disabled buttons)
//   but do NOT update canonical state until server confirms
```

### New Components

- `AgentConversation.tsx` — message list + input
- `AgentWorkspace.tsx` — phase-dependent workspace
- `SectionCard.tsx` — status, preview, accept/regenerate buttons
- `BlueprintCard.tsx` — call blueprint summary
- `EligibilityCard.tsx` — eligibility display
- `OutlineView.tsx` — section outline with approve action
- `ValidationSummary.tsx` — review phase checklist
- `WarningsBar.tsx` — warnings/blockers panel

---

## 7. Migration Path

### Strategy: Feature-flagged clean replacement

Not gradual — the architectures are fundamentally different. No meaningful "partially migrated" state.

### Phase 1: Build v3 alongside v2

- All new files in `lib/ai/agent/` (parallel to `lib/ai/orchestrator/`)
- New route at `/api/ai/agent` (parallel to `/api/ai/orchestrator/`)
- New hook `useAgent` (parallel to `useOrchestrator`)
- DB migration adds new tables, doesn't touch existing
- Extract provider logic from `gateway.ts` → `lib/ai/providers/`

### Phase 2: Internal testing

- Feature flag `agent_v3_enabled` targeting admin user only
- Project page conditionally renders v3 or v2 components

### Phase 2.5: Shadow mode

- v3 runs in parallel on same inputs, doesn't persist final projects
- Compare: blueprint quality, section structure, eligibility, latency, cost, failure rate

### Phase 3: Gradual rollout

- 3a: Selected testers
- 3b: Selected programs (PNRR, PEO)
- 3c: 100% rollout

### Phase 4: Cleanup

- Delete `lib/ai/orchestrator/` directory
- Delete `/api/ai/orchestrator/` route
- Delete `useOrchestrator` hook
- Remove feature flag
- Update CLAUDE.md

### V2 Session Policy

- Active V2 sessions: remain on V2, read-only after 30 days
- New sessions: always V3 (when flag ON)
- No migration of in-progress V2 → V3 (incompatible state models)

### Provider Layer Extraction

Before deleting `gateway.ts`:

```
lib/ai/providers/
  ├── types.ts      # ProviderConfig, GenerateRequest, GenerateResult
  ├── openai.ts     # Client setup + generate
  ├── anthropic.ts  # Client setup + generate
  ├── google.ts     # Client setup + generate
  ├── perplexity.ts # Client setup + generate
  ├── router.ts     # Model routing logic
  └── retry.ts      # Retry + fallback chain
```

### V2 Audit Findings Disposition

| V2 Finding | V3 Disposition |
|---|---|
| Missing DB migration | Fixed: v3 migration includes all new tables |
| QA warnings don't block | Fixed: `validate_application` is mandatory gate |
| Closed calls not blocked | Fixed: freshness required for completion |
| Edit step 7 mismatch | Eliminated: no step numbers |
| Budget slug mismatch | Fixed: section keys from `extract_structure` |
| Stale test files | Deleted in Phase 4 |

---

## 8. Testing Strategy & Success Criteria

### Unit Tests

One per tool + runtime/policies/history/transitions (16+ test files).

### Integration Tests

- Session lifecycle (create → complete)
- State persistence across requests + optimistic concurrency
- call_knowledge cache (write, hit, provisional → verified)
- Section versioning (generate → accept → regenerate → re-accept)
- Invalidation cascade (call change, outline change)

### E2E Tests (Playwright)

- Happy path: full flow
- Reconnect: disconnect mid-stream, verify state reconciliation
- Invalidation: change call mid-drafting
- Policy gates: blocked actions produce correct UI
- Structured actions: all button flows

### Shadow Mode Metrics

| Metric | V3 target | Rollback trigger |
|---|---|---|
| Blueprint completeness | >= V2 | < 80% of V2 |
| Structure confidence | >= 0.6 avg | < 0.4 avg |
| Section generation success | >= 90% | < 80% |
| Section first-draft acceptance | >= 70% | < 50% |
| Validation pass rate | >= 80% true passes | < 60% |
| Tokens per proposal | <= 40K | > 70K |
| Cost per proposal | <= $0.60 | > $1.20 |
| Latency (interactive) | <= 4 min | > 6 min |
| Tool failure rate | < 5% | > 15% |

### Rollback Criteria

**Automatic** (flip flag OFF):
- Tool failure rate > 15% / 1h
- Session creation failure > 5%
- DB write failures > 3 / 10min

**Manual** (review within 24h):
- Section acceptance < 50% over 10 sessions
- Completion time > 2x V2
- > 3 state inconsistency reports

### Build Order

1. DB migration + shared types + transitions + policies
2. Provider extraction from gateway.ts
3. Tool registry + core read/decision tools
4. Runtime loop (agent runtime + streaming)
5. useAgent hook + streamed POST transport
6. Section generation/regeneration tools
7. Validation + review flow + policy gates
8. Batch primer + shadow mode infrastructure
9. Frontend components (workspace, section cards, etc.)
10. E2E tests + rollout

---

## File Map

### New files

**Runtime:**
- `app/src/lib/ai/agent/runtime.ts`
- `app/src/lib/ai/agent/types.ts`
- `app/src/lib/ai/agent/policies.ts`
- `app/src/lib/ai/agent/history.ts`
- `app/src/lib/ai/agent/prompt.ts`
- `app/src/lib/ai/agent/transitions.ts`

**Tools:**
- `app/src/lib/ai/agent/tools/registry.ts`
- `app/src/lib/ai/agent/tools/search-calls.ts`
- `app/src/lib/ai/agent/tools/get-call-blueprint.ts`
- `app/src/lib/ai/agent/tools/resolve-call.ts`
- `app/src/lib/ai/agent/tools/retrieve-call-evidence.ts`
- `app/src/lib/ai/agent/tools/refresh-call-freshness.ts`
- `app/src/lib/ai/agent/tools/run-eligibility.ts`
- `app/src/lib/ai/agent/tools/extract-structure.ts`
- `app/src/lib/ai/agent/tools/generate-section.ts`
- `app/src/lib/ai/agent/tools/regenerate-section.ts`
- `app/src/lib/ai/agent/tools/validate-section.ts`
- `app/src/lib/ai/agent/tools/validate-application.ts`
- `app/src/lib/ai/agent/tools/list-missing-annexes.ts`

**Providers:**
- `app/src/lib/ai/providers/types.ts`
- `app/src/lib/ai/providers/openai.ts`
- `app/src/lib/ai/providers/anthropic.ts`
- `app/src/lib/ai/providers/google.ts`
- `app/src/lib/ai/providers/perplexity.ts`
- `app/src/lib/ai/providers/router.ts`
- `app/src/lib/ai/providers/retry.ts`

**API:**
- `app/src/app/api/ai/agent/route.ts`
- `app/src/app/api/ai/agent/state/route.ts`

**Frontend:**
- `app/src/hooks/useAgent.ts`
- `app/src/components/agent/AgentConversation.tsx`
- `app/src/components/agent/AgentWorkspace.tsx`
- `app/src/components/agent/SectionCard.tsx`
- `app/src/components/agent/BlueprintCard.tsx`
- `app/src/components/agent/EligibilityCard.tsx`
- `app/src/components/agent/OutlineView.tsx`
- `app/src/components/agent/ValidationSummary.tsx`
- `app/src/components/agent/WarningsBar.tsx`

**DB:**
- `app/drizzle/XXXX_agent_v3.sql`

**Scripts:**
- `app/scripts/prime-call-knowledge.ts`

**Tests:**
- `app/tests/unit/agent-runtime.test.ts`
- `app/tests/unit/agent-policies.test.ts`
- `app/tests/unit/agent-history.test.ts`
- `app/tests/unit/agent-transitions.test.ts`
- `app/tests/unit/agent-prompt.test.ts`
- `app/tests/unit/tool-*.test.ts` (one per tool)
- `app/tests/integration/agent-session-lifecycle.test.ts`
- `app/tests/integration/agent-state-persistence.test.ts`
- `app/tests/integration/agent-call-knowledge-cache.test.ts`
- `app/tests/integration/agent-section-versioning.test.ts`
- `app/tests/integration/agent-invalidation-cascade.test.ts`
- `app/tests/playwright/agent-happy-path.spec.ts`
- `app/tests/playwright/agent-reconnect.spec.ts`
- `app/tests/playwright/agent-invalidation.spec.ts`
- `app/tests/playwright/agent-policy-gates.spec.ts`
- `app/tests/playwright/agent-structured-actions.spec.ts`

### Deleted (Phase 4)
- `app/src/lib/ai/orchestrator/` (entire directory)
- `app/src/app/api/ai/orchestrator/` (entire directory)
- `app/src/hooks/useOrchestrator.ts`
- `app/tests/unit/agent-validate.test.ts`
- `app/tests/unit/agent-knowledge.test.ts`

### Kept (reused by v3 tools)
- `app/src/lib/ai/orchestrator/section-specs.ts` → move to `lib/ai/agent/section-specs.ts`
- `app/src/lib/ai/orchestrator/qa.ts` → refactor into validate tools
- `app/src/lib/ai/orchestrator/utils.ts` → `parseAIJson` kept, moved to `lib/ai/agent/utils.ts`
- `app/src/lib/rules/eligibility.ts` — unchanged
- `app/src/lib/rag/pipeline.ts` — unchanged
- `app/src/lib/vectors/store.ts` — unchanged
