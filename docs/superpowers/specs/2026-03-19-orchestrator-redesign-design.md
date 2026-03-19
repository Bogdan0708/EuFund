# FondEU Platform Redesign — AI Orchestrator & Minimalist UI

**Date:** 2026-03-19
**Status:** Draft
**Scope:** Full platform redesign — UI simplification, agent orchestrator, knowledge architecture, funding discovery, project builder

---

## 1. Overview

Redesign FondEU from a multi-page dashboard into a minimalist two-page app (Chat + Projects) powered by an AI orchestrator that coordinates specialized agents through a 7-step guided workflow. The orchestrator produces near-submission-ready EU funding project documents.

### Goals

- Simple, minimalistic, Apple-style UI
- AI orchestrator with specialized agents for each workflow step
- Continuous funding discovery with human review gate
- Automatic knowledge enrichment (Qdrant) from agent research
- Full project document generation with inline editing and DOCX/PDF export

### Non-Goals

- Multi-user organizations / role hierarchy (deferred)
- NotebookLM as runtime knowledge source (stays as offline curation tool)
- Real-time push notifications for funding alerts (v1 is daily + in-chat)

---

## 2. UI Architecture

### Two Routes Only

- `/[locale]/` — Chat page (landing page, main experience)
- `/[locale]/proiecte` — Projects page (saved projects grid)

### Chat Page

- Centered conversation column (max-width ~720px)
- Top bar: logo left, **project selector** (center), user avatar/menu right (settings, billing, logout in dropdown)
- **Project selector:** minimal pill showing current project name (or "New project"). Click opens dropdown with:
  - `+ New project` — starts fresh workflow
  - Recent projects/sessions listed by name + status
  - Each shows: project title (or "Untitled"), step progress (e.g., "Step 4/7"), last active date
  - Selecting loads message history and resumes where user left off
  - Subtle text + chevron, Apple style
- Message input at bottom (fixed), large text area with send button and file attach
- Agent step indicators: collapsible cards between messages showing step progress (e.g., "Matching grants..." → "Found 3 matches") with subtle expand animation
- Checkpoint moments: agent pauses and presents options as clickable cards (e.g., "I found these 3 calls — which one to research deeper?")
- Discovery notifications: inline message "2 new calls discovered since last visit — review?"
- File upload: drag & drop or file picker on message input (PDF, DOCX, XLSX, TXT, images, max 15MB)
- GDPR consent: cookie banner renders at bottom of chat page for unauthenticated users; consent preferences accessible from user avatar dropdown

### Projects Page

- Grid of project cards (title, matched program, status badge, last updated)
- Click opens project detail view:
  - Collapsible section panels (generated project document, editable inline)
  - Files tab with two categories: Uploaded (user docs) and Generated (AI outputs)
  - Each file: name, type, date, size, download button
  - Upload button for adding files from project page (same 15MB limit)
  - Export button (DOCX/PDF)
- Status flow: `draft` → `action_plan` → `built` → `exported`

### Apple Aesthetic

- Inter font stack (SF Pro requires Apple developer license for web distribution)
- White background, #f5f5f7 secondary
- Single accent color (blue, Apple link blue)
- Subtle shadows, no hard borders
- Smooth transitions (200-300ms ease)
- Large touch targets, generous padding
- Typography-driven, lots of whitespace
- No clutter — no sidebars, no dense tables

### What Gets Deleted (UI)

- Sidebar navigation
- Dashboard (panou), documents, legislation, settings, audit, approvals pages
- All standalone AI widgets (GrantMatcher, ProposalWizard, ProjectWizard, etc.)
- ConversationalWizard (replaced by new chat)

---

## 3. Authentication

### Simplified Auth

- **Google login** — primary (covers ~80% of Romanian organizations)
- **Email magic link** — fallback (for government entities without Google accounts)
- **No passwords** — delete credentials provider, bcrypt, reset/verification flows
- **No org roles in Plus/Pro** — one user = one account = their projects
- **Ultra tier** — up to 5 users with shared project access (simple team, no role hierarchy)
- **Tiers** — `free` (1 workflow total), `plus` (£10/mo), `pro` (£50/mo), `ultra` (£200/mo)
- **Billing** — Stripe

### What Gets Deleted (Auth)

- Credentials provider (password login)
- bcrypt password hashing
- Forgot/reset password flow
- Email verification flow
- Org roles, org membership, `requireOrgRole()`

---

## 4. Orchestrator Architecture

### File Structure

```
lib/ai/orchestrator/
├── engine.ts          — State machine: workflow state, step transitions, checkpoints
├── agents/
│   ├── enhance.ts     — Step 1: Refines raw idea, asks clarifying questions
│   ├── match.ts       — Step 2: Queries Qdrant for matching calls
│   ├── validate.ts    — Step 3: Web search (Perplexity + Gemini) to verify call is current
│   ├── research.ts    — Step 4: Deep targeted search for requirements, forms, deadlines
│   ├── knowledge.ts   — Step 5: Feeds research results back to Qdrant
│   ├── plan.ts        — Step 6: Generates structured action plan
│   └── build.ts       — Step 7: Produces full project document
├── prompts/
│   ├── enhance.ts     — System prompt for enhance agent
│   ├── match.ts       — System prompt for match agent
│   ├── validate.ts    — System prompt for validate agent
│   ├── research.ts    — System prompt for research agent
│   ├── knowledge.ts   — System prompt for knowledge agent
│   ├── plan.ts        — System prompt for plan agent
│   ├── build.ts       — System prompt for build agent
│   └── system.ts      — Shared base context injected into all agents
├── context.ts         — Shared workflow context (accumulated data passed between steps)
├── stream.ts          — SSE manager: multiplexes agent progress + AI output to client
└── types.ts           — Workflow state, step definitions, event types
```

### Workflow Steps

| Step | Agent | What It Does |
|------|-------|-------------|
| 1 | Enhance | Refines raw idea, asks clarifying questions |
| 2 | Match | Queries Qdrant + knowledge base for matching programs/calls |
| 3 | Validate | Web search (Perplexity + Gemini) to verify call is still open, check for updates |
| 4 | Research | Deep targeted search for requirements, forms, deadlines, certificates |
| 5 | Knowledge | Feeds research results back to Qdrant (chunks, embeds, upserts) |
| 6 | Plan | Generates structured action plan (steps, documents, timeline, responsibilities) |
| 7 | Build | Produces full project document (all sections, program-specific extras) |

### Provider Routing Per Agent

Each agent specifies provider and model explicitly in its gateway request (e.g., `provider: "claude", model: "claude-sonnet-4-0"`). The gateway already supports per-request provider/model selection.

| Agent | Provider | Why |
|-------|----------|-----|
| Enhance | Gemini 2.5 Flash | Cost-efficient idea refinement |
| Match | Gemini 2.5 Flash | Structured scoring against known data |
| Validate | Perplexity Sonar + Gemini 2.5 Flash | Web search + verification |
| Research | Perplexity Sonar Pro + Gemini 2.5 Pro + Claude Sonnet | Deep research needs quality |
| Knowledge | OpenAI Embeddings + Gemini 2.5 Flash | Embeddings + document chunking |
| Plan | Claude Sonnet | Complex structuring benefits from Claude |
| Build | **Tier-dependent** (see below) | Highest quality for the product output |
| Edits | Claude Sonnet | Single-section, small context |

**Build model by tier:**

| Tier | Build Model | Why |
|------|------------|-----|
| Free / Plus | Claude Sonnet | Good quality, cost-efficient |
| Pro / Ultra | GPT-5.4 or Claude Opus 4.6 | Premium output quality as a tier perk |

### Post-Completion Editing

After step 7 completes, the chat stays connected to the project. Users can request changes:

- **"Rewrite section 5"** → Build agent regenerates just that section, preserving the rest
- **"Add a risk about X"** → Build agent appends to the relevant section
- **"The budget should be 500K not 300K"** → Build agent recalculates budget section
- **"Make it more formal"** → Build agent adjusts tone across all sections
- **"Add this document to annexes"** → user attaches file, agent updates annexes checklist

Edit operations use Claude Sonnet (cost-efficient for single-section work, ~$0.05-0.10 per edit) and are counted as edit credits, separate from workflow credits.

### Caching Strategy

To reduce costs, agent research results are cached aggressively:

- **Step 3-4 results** (call validation + deep research) cached by `callId` + date. If another user researches the same call within 24h, cached results are reused.
- **Step 5** (knowledge ingestion) is idempotent — same content won't be re-embedded (dedup by content hash).
- **Step 2** (match results) cached by program + sector + region for 1h.
- Cache stored in Redis with TTL. Cache hits skip the AI call entirely.
- Estimated cost reduction: ~30-40% for popular programs/calls.

### Engine Mechanics

1. User sends a message → API route receives it
2. Engine determines current workflow state (new conversation or resuming)
3. Engine dispatches to the relevant agent function
4. Agent makes AI calls (gateway) and/or web calls (Perplexity, crawlers)
5. Agent streams progress events + AI output back through SSE
6. At checkpoint moments, agent yields control back to the user (waits for input)
7. User responds → engine advances to next step or re-runs current step with new input

### Agent Interface

```typescript
type AgentFn = (
  ctx: WorkflowContext,    // accumulated data from prior steps
  input: string,           // user's message
  stream: SSEStream,       // to push progress events
  gateway: GatewayClient   // to make AI calls
) => Promise<AgentResult>  // output data + optional checkpoint question
```

### System Prompts

Each agent gets a tailored system prompt defining its role, constraints, and output format. Stored as TypeScript template functions in `prompts/` that take `WorkflowContext` and return the full system prompt with dynamic context.

Shared base (`system.ts`) injected before every agent prompt:
- Platform context (Romanian EU funding, bilingual ro/en)
- Current user's project context (accumulated from prior steps)
- Quality rules (cite sources, use official terminology, flag uncertainty)
- Output language rules (match user's locale)

Prompts are separate from agent logic — can be iterated independently.

### Error Recovery & Resilience

**Per-step retry policy:**

| Failure Type | Behavior |
|-------------|----------|
| Gateway timeout / 5xx | Retry up to 2 times with exponential backoff (2s, 4s) |
| Perplexity unavailable (steps 3, 4) | Skip web validation, proceed with Qdrant-only data, warn user |
| Qdrant unavailable (step 5) | Queue ingestion for later, proceed to step 6 |
| Qdrant unavailable (step 2) | Fail with error — cannot match without knowledge base |
| Provider returns garbage | Retry once with same prompt, then fail step with error |
| User-facing error | Stream `error` event with human-readable message, offer retry button |

**Step navigation:**
- Forward only — no backward navigation in v1
- User can retry current step (re-runs with same or modified input)
- User can abandon workflow (sets status to `abandoned`)
- New workflow can be started at any time (previous one auto-paused)

**Session lifecycle:**
- `active` — workflow in progress
- `paused` — user started a new workflow or disconnected for >24h
- `completed` — step 7 finished and project saved
- `abandoned` — user explicitly abandoned, or inactive for 7 days (cron cleanup)
- Max active/paused sessions per tier: Free=1, Plus=2, Pro=3, Ultra=10

### Workflow Session Persistence

New table: `workflow_sessions`

```
id              UUID PK DEFAULT gen_random_uuid()
userId          UUID NOT NULL (FK users, INDEX)
projectId       UUID (nullable — set when step 7 saves, FK projects)
currentStep     INTEGER NOT NULL DEFAULT 1 (1-7)
context         JSONB NOT NULL DEFAULT '{}'
status          ENUM: active, paused, completed, abandoned (INDEX)
createdAt       TIMESTAMP NOT NULL DEFAULT now()
updatedAt       TIMESTAMP NOT NULL DEFAULT now()
```

### Chat Message Persistence

New table: `workflow_messages`

```
id              UUID PK DEFAULT gen_random_uuid()
sessionId       UUID NOT NULL (FK workflow_sessions, INDEX)
role            ENUM: user, assistant, system
content         TEXT NOT NULL
step            INTEGER (nullable — which workflow step this message belongs to)
eventType       TEXT (nullable — 'checkpoint', 'step_complete', etc.)
metadata        JSONB (nullable — checkpoint data, file references, etc.)
createdAt       TIMESTAMP NOT NULL DEFAULT now()
```

Messages are stored as they flow through the SSE stream. On reconnect or page refresh, the client fetches message history via `GET /api/ai/orchestrator/messages?sessionId=xxx` and renders the conversation. AI-streamed chunks are concatenated into a single assistant message after the stream completes.

---

## 5. SSE Streaming & Real-Time Communication

### Single SSE Endpoint

`GET /api/ai/orchestrator/stream?sessionId=xxx&lastEventId=N`

### Event Types

All events include a monotonic `eventId` for replay on reconnect:

```typescript
type SSEEvent = {
  eventId: number  // monotonic sequence per session, persisted in workflow_messages
} & (
  | { type: 'step_start',    step: number, label: string }
  | { type: 'step_progress', step: number, message: string }
  | { type: 'ai_chunk',      step: number, content: string }
  | { type: 'checkpoint',    step: number, data: CheckpointData }
  | { type: 'step_complete', step: number, summary: string }
  | { type: 'discovery',     items: DiscoveredCall[] }
  | { type: 'error',         step: number, message: string, retryable: boolean }
  | { type: 'done',          projectId?: string }
)
```

### Communication Flow

1. Client opens SSE connection on page load (reconnects automatically)
2. User sends message via `POST /api/ai/orchestrator/message` with `sessionId` + text + optional file attachments
3. POST returns immediately (202 Accepted)
4. Orchestrator engine processes asynchronously, pushes events through SSE
5. At checkpoints, client renders interactive options (cards, buttons)
6. User clicks/types → new POST → engine continues

### Connection Management

- SSE with automatic reconnect (EventSource API, 3s retry)
- Client sends `lastEventId` on reconnect — server replays missed events from `workflow_messages`
- Replay endpoint: `GET /api/ai/orchestrator/replay?sessionId=xxx&afterEventId=N`
- Server heartbeat every 30s (`:keepalive\n\n`)
- Session state in DB — reconnect resumes cleanly
- One connection per browser tab
- Cloud Run request timeout set to 3600s for SSE endpoint (max allowed)
- If connection drops mid-generation, agent continues server-side; results stored in messages table; client catches up on reconnect

---

## 6. Knowledge Architecture

### Runtime: Qdrant Primary

- Agents query Qdrant via existing hybrid search (semantic + keyword boost)
- Results ranked, deduplicated, validated against poisoning patterns (existing `lib/rag/pipeline.ts`)
- Per-source token budgeting (500 tokens/source, 1600 total context)

### Knowledge Enrichment (Step 5)

- Web research results from Validate + Research steps get chunked and embedded
- Upserted to Qdrant with metadata:
  - `sourceUrl`, `program`, `discoveredAt`
  - `verified: false` (auto-ingested from agent research)
  - `sourceType: 'agent_research'` (distinguishes from curated content)
- **Retrieval weighting:** `verified: true` content ranked 1.5x higher than `verified: false` in hybrid search scoring
- **Poisoning validation:** All auto-ingested chunks pass through existing poisoning pattern detection before Qdrant upsert
- **Admin promotion:** Admin can mark agent-discovered content as `verified: true` via chat review flow
- Knowledge base grows with each interaction but curated content always takes priority

### Offline Curation

- NotebookLM stays as your deep research tool via CLI/MCP
- Run existing ingestion pipeline to push curated knowledge to Qdrant (ingested as `verified: true`)
- `generate-knowledge-vault.ts` → `bulk-ingest-rag-knowledge.ts` flow unchanged

### Discovery Pipeline

- New calls discovered → queued for review in chat
- After admin approval → auto-ingested into Qdrant with `verified: true`
- Before approval → stored in DB as `discovered_calls` with `status: pending_review`

---

## 7. Funding Discovery & Monitoring

### Daily Automated Pipeline

Cloud Scheduler triggers `POST /api/v1/admin/discovery/run` once daily (06:00 EET).

**Pipeline steps:**

1. Crawl known sources (11 existing crawlers + EC portal)
2. Perplexity sweep via gateway ("new EU funding calls Romania [month/year]", "noi apeluri fonduri europene Romania 2026")
3. Diff against existing `calls_for_proposals` (match by SHA-256 hash of normalized title + source domain + program)
4. Store new finds in `discovered_calls` with status `pending_review`
5. Flag existing calls with passed deadlines as `expired`

### Funding Call Lifecycle

`discovered_calls` is the staging table. On admin approval, data is promoted to `calls_for_proposals` (canonical table). The existing `funding_calls` table (EC Portal) is consolidated into `calls_for_proposals` via migration.

```
Discovery → discovered_calls (staging, pending_review)
                ↓ admin approves
         calls_for_proposals (canonical, active)
                ↓ deadline passes
         calls_for_proposals (canonical, expired)
```

### New Table: `discovered_calls`

```
id              UUID PK DEFAULT gen_random_uuid()
sourceUrl       TEXT NOT NULL
sourceDomain    TEXT NOT NULL (extracted from sourceUrl for dedup)
title           TEXT NOT NULL
program         TEXT (detected)
summary         TEXT (AI-generated)
rawContent      TEXT
contentHash     TEXT NOT NULL (SHA-256 of normalized title + sourceDomain + program, UNIQUE)
discoveredAt    TIMESTAMP NOT NULL DEFAULT now()
discoveryMethod ENUM: crawler, perplexity, manual
discoverySource TEXT (e.g., 'adr-nord-est', 'sweep-2026-03')
status          ENUM: pending_review, approved, rejected, expired (INDEX)
reviewedBy      UUID (nullable, FK users)
reviewedAt      TIMESTAMP (nullable)
callId          UUID (nullable, FK calls_for_proposals — set after approval)
```

### User-Configurable Alerts

New table: `program_alerts`

```
id              UUID PK DEFAULT gen_random_uuid()
userId          UUID NOT NULL (FK users, INDEX)
program         TEXT NOT NULL ('PNRR', 'PEO', or '*' for all)
urgency         ENUM: daily (v1 only, extend later)
createdAt       TIMESTAMP NOT NULL DEFAULT now()
```

- `daily` — discoveries batched, shown next time user opens chat

### Chat Integration

- **Admin sees:** "I found 2 new calls since yesterday. Want to review?" → cards with title, program, source, summary → approve/reject inline
- **Regular user sees:** "A new PNRR call was published that matches your interests: [title]. Want to explore it?"

---

## 8. Project Builder & Export

### Step 6 — Action Plan

Structured output stored as JSONB in `workflow_sessions.context`:

```typescript
interface ActionPlan {
  matchedCall: {
    title: string
    program: string
    deadline: string
    budget: { min: number, max: number, currency: string }
    sourceUrl: string
  }
  steps: {
    order: number
    title: string
    description: string
    category: 'document' | 'approval' | 'registration' | 'writing' | 'budget'
    deadline?: string
    responsible?: string
    dependencies: number[]
  }[]
  requiredDocuments: {
    name: string
    source: string
    estimatedTime: string
    mandatory: boolean
  }[]
  estimatedTimeline: string
}
```

### Step 7 — Build Project

Default sections (Cerere de finanțare):

1. Rezumat proiect
2. Context și justificare
3. Obiective (general + specifice SMART)
4. Grup țintă
5. Activități și metodologie (work packages + Gantt)
6. Resurse și buget (breakdown by category)
7. Rezultate și indicatori (output/outcome)
8. Sustenabilitate
9. Capacitate instituțională
10. Riscuri (matrix + mitigation)
11. Anexe checklist

Program-specific extras discovered by the Research agent (step 4) get appended (e.g., PNRR: Contribuția la obiectivele climatice, DNSH; PEO: Egalitate de șanse).

### Storage

New table: `project_documents`

```
id              UUID PK DEFAULT gen_random_uuid()
projectId       UUID NOT NULL (FK projects, INDEX)
version         INTEGER NOT NULL DEFAULT 1
sections        JSONB NOT NULL (array of { title, content, order, source: 'generated'|'edited' })
actionPlan      JSONB (ActionPlan from step 6)
metadata        JSONB (matched call info, research sources used)
status          ENUM: draft, review, final
createdAt       TIMESTAMP NOT NULL DEFAULT now()
updatedAt       TIMESTAMP NOT NULL DEFAULT now()
```

Note: Per-section versioning is not in v1. The whole document is versioned — editing creates a new version row. Concurrent edits are last-write-wins (acceptable for single-user v1). Section-level versioning can be added later if multi-user editing is needed.

### Project Files

New table: `project_files`

```
id              UUID PK DEFAULT gen_random_uuid()
projectId       UUID NOT NULL (FK projects, INDEX)
userId          UUID NOT NULL (FK users)
filename        TEXT NOT NULL
mimeType        TEXT NOT NULL
sizeBytes       BIGINT NOT NULL
storagePath     TEXT NOT NULL (GCS path or local path)
category        ENUM: uploaded, generated
description     TEXT (nullable — AI-generated summary)
extractedText   TEXT (nullable — parsed text for agent context)
createdAt       TIMESTAMP NOT NULL DEFAULT now()
```

- Chat uploads and project page uploads both write here (max 15MB, same limit everywhere)
- Generated exports (DOCX/PDF from step 7) also stored with `category: 'generated'`
- Project detail view shows files in two categories: Uploaded and Generated
- Replaces existing `documents` table (migration moves existing document rows to `project_files`)

### Inline Review

- Section panels collapsible, editable inline (rich text, auto-saves)
- Edit marks section as `source: 'edited'` (won't be overwritten on regeneration)
- User can ask chat to "regenerate section 3" or "make the budget more detailed"

### Export

- `POST /api/v1/projects/:id/export?format=docx|pdf`
- **DOCX:** `docx-templater` — template-based, lightweight, no binary dependencies
- **PDF:** `@react-pdf/renderer` — server-side React-to-PDF, no headless Chrome needed. Custom renderer maps JSONB sections to React-PDF components.
- Standard formatting: cover page, headers, page numbers, table of contents
- Budget tables, Gantt chart (simplified), risk matrix as formatted tables

---

## 9. Gateway Streaming Enhancement

### Changes to AI Gateway (`ai-gateway` repo)

Add SSE pass-through for `/v1/chat/completions` when `stream: true`.

**Flow:**

```
FondEU Orchestrator → Gateway (stream: true) → Provider
                              ↓
                    Response headers:
                      Content-Type: text/event-stream
                      Cache-Control: no-cache
                      Connection: keep-alive
                              ↓
                    Provider streams SSE chunks
                              ↓
                    Gateway forwards chunks
                    (adds tenant_id, tracks usage from final chunk)
                              ↓
                    Orchestrator receives streamed tokens
```

**Gateway changes:**

1. `src/providers/*.ts` — Each provider's `complete()` gets a `stream` variant returning `ReadableStream`
2. `src/index.ts` — `/v1/chat/completions` detects `stream: true`, pipes provider stream to response
3. Usage tracking — extract from final `[DONE]` chunk or `usage` field
4. Fallback — only works pre-stream; mid-stream failure sends SSE error event and closes
5. Tenant policies — enforced before stream starts (unchanged)
6. Timeout — increase from 15s to 120s for streaming requests

**Unchanged:** `/complete` endpoint, `/v1/embeddings`, auth, rate limiting, concurrency, fallback chain logic.

---

## 10. What Gets Deleted

### API Endpoints Removed (~15)

- `/api/ai/analyze-document` — folded into research agent
- `/api/ai/validate-compliance` — folded into build agent
- `/api/ai/project-analysis`, `/api/ai/project-health` — removed
- `/api/ai/predict-success`, `/api/ai/forecast-lifecycle` — removed
- `/api/ai/optimize-timeline`, `/api/ai/optimize-budget` — removed
- `/api/ai/analyze-consortium`, `/api/ai/recommend-partners` — removed
- `/api/ai/market-intelligence`, `/api/ai/advanced-analytics` — removed
- `/api/ai/roman-market-intelligence` — removed
- `/api/ai/deadline-risk-assessment` — removed
- `/api/ai/wizard/*` (5 endpoints) — replaced by orchestrator

### Auth Code Removed

- Credentials provider (bcrypt, password validation)
- Forgot/reset password flow
- Email verification flow
- Org roles, org membership, `requireOrgRole()`

### UI Components Removed

- Sidebar navigation
- Dashboard widgets
- All standalone AI widgets (GrantMatcher, ProposalWizard, ProjectWizard, etc.)
- ConversationalWizard (replaced by new chat)

### What Stays

- NextAuth (Google + magic link providers)
- Stripe billing (free/plus/pro/ultra tiers)
- RAG pipeline + Qdrant
- Crawlers + connector system
- Audit logging (`logAudit` — GDPR compliance, no UI page)
- CSRF, CSP, rate limiting middleware
- i18n (ro/en)
- Storage abstraction (GCS + local, `lib/storage/gcs.ts`)
- File parser (`lib/ai/knowledge/parser.ts`)

---

## 11. Data Migration Plan

### Phase 1: Schema Preparation

**Organizations → User-owned projects:**

The existing `projects.orgId` is NOT NULL with FK to `organizations`. Migration steps:

1. Add `projects.userId` column (nullable initially)
2. Populate `userId` from `org_members` (pick the admin or first member of each org)
3. Make `userId` NOT NULL
4. Make `orgId` nullable
5. Drop FK constraint on `orgId`
6. Drop `orgId` column

Same pattern for other tables referencing organizations: `documents` → `project_files`, `aiReviews`, `workPackages`.

**RLS policy rewrite:**

All existing RLS policies query `org_members`. Rewrite to use `app.current_user_id` directly against `projects.userId`:

```sql
-- Before: SELECT 1 FROM org_members WHERE org_id = projects.org_id AND user_id = ...
-- After:  projects.user_id = current_setting('app.current_user_id')::uuid
```

**Status enum consolidation:**

Existing `projectStatusEnum` uses Romanian values (`ciorna`, `in_lucru`, `trimis`, `aprobat`, `respins`). New flow uses English (`draft`, `action_plan`, `built`, `exported`).

Migration: Add new enum values, map existing:
- `ciorna` → `draft`
- `in_lucru` → `draft`
- `trimis` → `exported`
- `aprobat` → `exported`
- `respins` → `draft`

Then drop old values.

**Consolidate funding call tables:**

Merge `funding_calls` (EC Portal, simple schema) into `calls_for_proposals` (canonical, rich schema). Add any EC Portal-specific fields as nullable columns. Drop `funding_calls` table.

**Documents → project_files:**

Migrate existing `documents` rows to `project_files` with `category: 'uploaded'`. Drop `documents` table.

### Phase 2: User Access Migration

**Existing credential users:**

1. Before deploying auth changes, email all existing users: "We're upgrading login. Use Google or magic link starting [date]."
2. For users with Google-linked emails: auto-match on first Google login (match by email)
3. For users without Google: magic link to their existing email address
4. User accounts (UUID, email, tier, projects) are preserved — only the auth method changes
5. Grace period: keep credentials provider active for 30 days after announcement, then remove

### Phase 3: Rollback Strategy

- All migrations are additive first (add columns before dropping)
- Each step is a separate Drizzle migration file
- Old columns kept for 1 release cycle before final cleanup
- Database snapshots taken before each migration phase

---

## 12. Pricing & Rate Limiting

### Positioning

FondEU is a state-of-the-art, first-of-its-kind platform for the Romanian market. Pricing reflects professional-grade tooling for consultants, project managers, and firms — not a free/cheap service.

### Tier Structure

| Tier | Price | Users | Target |
|------|-------|-------|--------|
| **Free** | £0 | 1 | Demo — try before you buy |
| **Plus** | £10/mo | 1 | NGOs, small orgs |
| **Pro** | £50/mo | 1 | Consultants, project managers |
| **Ultra** | £200/mo | Up to 5 | Consulting firms, agencies |

### Limits

| | Free | Plus | Pro | Ultra |
|---|---|---|---|---|
| Workflows/mo | 1 total (ever) | 10 | 50 | 200 |
| Edit credits/mo | 5 total (ever) | 50 | 300 | Unlimited |
| Max active sessions | 1 | 2 | 3 | 10 |
| File storage | 50MB | 500MB | 5GB | 25GB |
| Export formats | DOCX only | DOCX only | DOCX + PDF | DOCX + PDF |
| Build model | Claude Sonnet | Claude Sonnet | GPT-5.4 / Opus 4.6 | GPT-5.4 / Opus 4.6 |
| Team members | 1 | 1 | 1 | 5 |

### Cost Per Workflow (Optimized)

| Step | Model | Est. Cost |
|------|-------|-----------|
| 1. Enhance | Gemini 2.5 Flash | ~$0.003 |
| 2. Match | Gemini 2.5 Flash | ~$0.005 |
| 3. Validate | Perplexity Sonar + Gemini Flash | ~$0.008 |
| 4. Research | Perplexity Pro + Gemini Pro + Claude Sonnet | ~$0.12 |
| 5. Knowledge | OpenAI Embeddings + Gemini Flash | ~$0.002 |
| 6. Plan | Claude Sonnet | ~$0.06 |
| 7. Build (Plus) | Claude Sonnet | ~$0.50 |
| 7. Build (Pro/Ultra) | GPT-5.4 / Opus 4.6 | ~$0.90 |
| **Total (Plus)** | | **~$0.70 (~£0.55)** |
| **Total (Pro/Ultra)** | | **~$1.10 (~£0.87)** |
| **With caching** | | **~30-40% reduction on steps 2-5** |
| **Per edit** | Claude Sonnet | **~$0.05-0.10 (~£0.06)** |

### Margin Analysis (Typical Usage)

Most users won't hit max limits. Assuming ~60% utilization:

| Tier | Revenue | Est. AI cost/mo | Margin |
|------|---------|----------------|--------|
| Free | £0 | ~£0.90 (one-time) | Loss leader |
| Plus (6 workflows, 30 edits) | £10 | ~£5.10 | **+£4.90** |
| Pro (30 workflows, 150 edits) | £50 | ~£35 | **+£15** |
| Ultra (120 workflows, 300 edits, 5 users) | £200 | ~£125 | **+£75** |

### Ultra Multi-User

Minimal schema for team access:

New table: `team_members`

```
id              UUID PK DEFAULT gen_random_uuid()
ownerId         UUID NOT NULL (FK users — the Ultra subscriber, INDEX)
memberId        UUID NOT NULL (FK users — invited team member, INDEX)
invitedAt       TIMESTAMP NOT NULL DEFAULT now()
acceptedAt      TIMESTAMP (nullable)
UNIQUE(ownerId, memberId)
```

- Owner invites by email. Invitee receives magic link, creates account (or links existing).
- All team members share the owner's projects, workflows, and files.
- No roles — everyone can view and edit everything.
- Limits are pooled across the team (200 workflows/mo total, not per member).
- Owner manages team from avatar dropdown → "Team" option.

### Counting & Enforcement

- A workflow counts against the monthly limit when step 1 starts (not on completion)
- An edit counts when the agent call is dispatched (not on user request)
- Token usage tracked per-workflow from gateway responses, stored in `workflow_sessions.context` as `tokenUsage: { total, perStep }`
- Partial workflows count as full workflows against monthly limit
- Monthly counters reset on billing cycle date (not calendar month)
- Check limits on `POST /api/ai/orchestrator/message` before dispatching to engine
- Return 429 with human-readable message ("You've used 10/10 monthly workflows. Upgrade to Pro for more.")
- Redis counter with TTL matching billing cycle for fast lookups

---

## 13. New Database Tables Summary

| Table | Purpose |
|-------|---------|
| `workflow_sessions` | Orchestrator state machine persistence |
| `workflow_messages` | Chat message history for conversation rendering |
| `discovered_calls` | Funding calls found by discovery pipeline (staging) |
| `program_alerts` | User alert preferences per program |
| `project_documents` | Versioned project document sections + action plans |
| `project_files` | User uploads + AI-generated files (replaces `documents`) |
| `team_members` | Ultra tier shared project access |

### Indexes

- `workflow_sessions`: `userId`, `status`
- `workflow_messages`: `sessionId`, `createdAt`
- `discovered_calls`: `status`, `contentHash` (UNIQUE)
- `program_alerts`: `userId`
- `project_documents`: `projectId`
- `project_files`: `projectId`
- `team_members`: `ownerId`, `memberId` (UNIQUE composite)

---

## 14. Infrastructure

- **FondEU** — Next.js on Cloud Run (europe-west2), monolithic orchestrator
- **AI Gateway** — Express on Cloud Run (europe-central2), multi-provider with streaming
- **Qdrant** — GCE VM (europe-west2), primary knowledge store
- **Cloud Scheduler** — daily discovery trigger (06:00 EET)
- **Cloud SQL** — PostgreSQL (existing)
- **GCS** — file storage (existing)
- **Redis** — rate limiting, caching (existing)
