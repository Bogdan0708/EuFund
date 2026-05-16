# AI Workflow Redesign — Deterministic Pipeline

**Status:** Design locked (2026-05-15). Implementation plans M1-M3 to follow via writing-plans.
**Authors:** Co-authored brainstorm between user (Bogdan0708) and Claude.
**Supersedes:** All "Agent V3" + "Managed Agents" architecture work since 2026-04-03.

---

## 1. Context

For two months the FondEU platform has been built around an autonomous V3 agent (5-phase state machine, MCP tool registry, two coexisting runtimes — V3 and Managed). Despite that scaffolding, **no user has ever successfully produced a complete proposal artifact through the platform**. Today's session traced this to converging failures: silent turn termination when the tool loop exhausts after emitting interim text (runtime.ts:631 guard), Drizzle schema drift that broke project promotion silently for 31 days, hash-based callIds in Qdrant that don't resolve to `calls_for_proposals.id` so blueprint lookups null out, placeholder frontend that never wired the export path, and unbounded Opus 4.6 spend on a chat loop that doesn't converge.

The fundamental error is the choice of abstraction: an autonomous agent that has to self-drive workflow phases, while the desired output is a deterministic document. The model should fill bounded schemas and draft bounded sections. The application should own the workflow.

This document specifies a clean replacement: a one-shot deterministic pipeline that takes a user's idea and produces a polished, exportable proposal with explicit placeholders for the data the user has not yet provided. The existing proven leaves (section specs, DOCX export, project persistence, call ranking after identity repair) are reused. The agent orchestration stack (V3 runtime, Managed runtime, MCP tool registry, phase state machine, chat surface) is retired after a measured compatibility window.

## 2. Goals & non-goals

### Goals

- User types one project idea → backend produces a polished EU funding proposal with placeholder tokens for user-supplied data plus a checklist of what still needs to be filled in
- One-shot deterministic pipeline. No autonomous tool loop, no phase state machine, no persistent chat surface
- Reuse proven leaves: section specs, DOCX export, call ranking semantics, project persistence
- Canonical call identity: `calls_for_proposals.id` (UUID) everywhere; Qdrant points carry that UUID as required metadata; orphan chunks rejected at ingest
- Inline `{{placeholder_id}}` tokens + structured sidecar (label, description, type, required) per section; values folded into the placeholders table for v1
- DOCX + raw Markdown export; in-app rich view by necessity
- Durable run state: DB-backed worker lease pattern so Cloud Run instance churn does not lose unfinished generations
- Idempotent POST entry; resumable for `needs_input` / `needs_call_selection`; SSE replay via `Last-Event-ID`
- Per-user concurrency = 1 active run, one auto-retry on transient provider failures

### Non-goals

- Multi-user load testing beyond per-user concurrency cap
- Cross-provider failover (single configured drafting model, single-retry on transient is the only resilience)
- PDF or Google Docs export (DOCX + .md only for v1)
- Long-document stress (>50 k section markdown) — bounded by configured `max_tokens`
- Localization beyond `ro` / `en`
- Automated accessibility audit (manual a11y pass + Playwright keyboard/focus smoke only)
- Provider model migration tooling (model name lives in env config, not in the spec)

## 3. User-facing outcome flow

```
1. User submits one idea (free text, Romanian or English).
2. Backend extracts structured intent from the idea.
3. If essential fields are missing, return a single form with 1-3 specific questions.
   User re-submits with clarifications.
4. Deterministic match against calls_for_proposals (DB filter ∩ Qdrant semantic rank).
5. If top-1 match margin > ε, that call wins. Otherwise return top-3 shortlist; user picks.
6. Backend resolves one canonical call identity (calls_for_proposals.id, plus call_code + title for display).
7. Backend builds the section list (11 defaults from section-specs.ts, ∪ per-call blueprint overrides).
8. Sections generate in parallel (bounded concurrency) via zero-tool model calls. Each call returns
   { markdown: '...{{placeholder_id}} tokens...', placeholders: [{id, label, description, type, required, sectionId}] }.
9. Each completed section is persisted incrementally; SSE event stream surfaces progress.
10. When all sections are terminal, the artifact is marked `ready` (or `partial_failed` if some failed but others succeeded).
11. User opens the artifact view: sees rendered sections with highlighted placeholder tokens + a checklist of what's still needed.
12. User fills placeholders (deterministic substitution at render time, no model call), regenerates individual sections (one model call), or edits markdown directly. Exports as DOCX or raw .md.
```

Chat does not exist as a workflow surface. Every iteration after generation is one of three deterministic operations: fill placeholder, regenerate section, edit directly.

## 4. Architecture overview

### 4.1 Single one-shot endpoint, three response statuses

```
POST /api/v1/projects/generate
  body: { idea, idempotencyKey }                                  -- initial
       | { artifactId, clarifications: IntentFields }              -- resume after needs_input
       | { artifactId, selectedCallId }                            -- resume after needs_call_selection

response: 200 with one of:
  { status: "needs_input",          artifactId, missing[], questions[] }
  { status: "needs_call_selection", artifactId, candidates: [{ id, code, title, score, why }] }
  { status: "running",              generationRunId, eventsUrl }
  { status: "failed",               artifactId, error }
```

### 4.2 SSE subscription is a separate resource

```
GET /api/v1/projects/generate/runs/{runId}/events
  Header: Last-Event-ID (optional, integer sequence)
  Returns: text/event-stream

GET /api/v1/projects/generate/runs/{runId}
  Returns: full snapshot { run, artifact, sections, placeholders }
```

The replay endpoint is the source of truth. SSE is a wakeup-driven optimization over `generation_run_events`.

### 4.3 Post-generation operations

All single REST requests, no SSE, no model loop:

```
PUT  /api/v1/projects/{projectId}/placeholders/{phId}            -- set value (deterministic)
POST /api/v1/projects/{projectId}/sections/{sectionKey}/regenerate  -- one zero-tool model call
PUT  /api/v1/projects/{projectId}/sections/{sectionKey}/content  -- direct markdown edit
GET  /api/v1/projects/{projectId}/export?format=docx|md          -- render
```

### 4.4 Status lifecycle

```
project_artifacts.status:
  pending_input         ──(essentials filled)──► pending_call_selection
                                              └─(unambiguous)─────────► generating
                        ──(unambiguous straight from initial POST)────► generating
                        ─────────────────────────────────────────────► failed (terminal)

  generating ──► ready
             ──► partial_failed (≥1 section failed, others ready)
             ──► failed (all sections failed)

generation_runs.status:
  queued → running → ready | partial_failed | failed
  Status advances monotonically. Failed/ready are terminal.
```

### 4.4.1 Initial POST creates `projects` + `project_artifacts` atomically

The initial POST does not require a pre-existing `projects` row. The handler creates both in a single transaction:

```
BEGIN
  -- idempotency check first
  SELECT * FROM project_artifacts
   WHERE user_id = $user AND idempotency_key = $key
     AND idempotency_expires_at > now()
  ; -- if hit: return existing artifact's current status, COMMIT, return.

  -- resolve target org via existing helper (auto-creates Personal Workspace if zero memberships,
  -- see lib/projects/org-resolver.ts:71)
  $orgId := resolveProjectOrgIdInTx(tx, $user, { autoPickOnAmbiguous: true })

  -- create the parent project row
  INSERT INTO projects (org_id, user_id, created_by, title, status)
       VALUES ($orgId, $user, $user, $derivedTitle, 'ciorna')
    RETURNING id INTO $projectId

  -- flip any prior active artifacts for this project (none yet, but consistent service contract)
  UPDATE project_artifacts SET is_active=false WHERE project_id=$projectId AND is_active=true

  -- create the artifact in pending_input state with idempotency metadata
  INSERT INTO project_artifacts (
    project_id, user_id, org_id,
    intent, title, status, is_active,
    idempotency_key, idempotency_expires_at
  ) VALUES (
    $projectId, $user, $orgId,
    jsonb_build_object('projectDescription', $idea),
    $derivedTitle, 'pending_input', true,
    $key, now() + interval '24 hours'
  ) RETURNING id INTO $artifactId
COMMIT
```

`$derivedTitle` uses `deriveProjectTitle({ projectDescription: $idea }, $locale)` (reused from `lib/projects/promotion.ts:79`). Resume-input and resume-call POSTs operate on `artifactId` directly — they do not carry an idempotency key, because the artifact id itself is the idempotent reference.

### 4.5 DB-backed worker lease pattern (durability)

```
generation_runs columns: locked_by, locked_until, heartbeat_at, idempotency_expires_at

Worker loop (in-process for v1, may move to a separate Cloud Run service later):
  1. Claim queued run: UPDATE ... SET locked_by=$worker_id, locked_until=now()+'5 min', heartbeat_at=now()
                       WHERE status='queued' AND (locked_by IS NULL OR locked_until < now())
                       RETURNING * ;  -- atomic claim
  2. Process sections with bounded parallelism (env.GENERATION_PARALLELISM, default 4)
  3. Heartbeat every ~10 s while processing
  4. On instance restart, abandoned leases (heartbeat_at < now() - 60 s) get reset to status='queued' by run-recovery scanner

Section-level durability mirrors run-level:
  artifact_sections.status: queued → generating → ready | edited | failed
  Worker recovery: section.status='generating' AND parent run.locked_by is null/stale → reset section.status='queued'
```

The recovery scanner runs:
- On app startup (best-effort, in-process)
- Via `POST /internal/runs/recover` triggered by Cloud Scheduler every 1 min (durable)

### 4.6 Model configuration

The drafting model is configured, not hard-coded into the spec. Default: `claude-sonnet-4-6`. Actual value lives in:
- `ANTHROPIC_DRAFTING_MODEL` env var (Cloud Run secret)
- `generation_runs.model_config` jsonb (per-run snapshot for audit)
- `generation_runs.prompt_version` varchar (per-run prompt template version)

## 5. Data model

### 5.1 New tables

```sql
-- One per AI-generated proposal attempt. N:1 with projects.
CREATE TABLE project_artifacts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES projects(id),
  user_id                 uuid NOT NULL REFERENCES users(id),
  org_id                  uuid NOT NULL REFERENCES organizations(id),
  call_id                 uuid REFERENCES calls_for_proposals(id),  -- nullable until match resolves
  intent                  jsonb NOT NULL,                            -- IntentSchema snapshot
  candidates              jsonb,                                     -- nullable; ranked top-3 stored when status='pending_call_selection'
                                                                     -- shape: [{ id: uuid, code, title, score, why }]; cleared once selectedCallId resolves
  title                   varchar(1000) NOT NULL,                    -- derived from intent.projectDescription
  status                  artifact_status_enum NOT NULL,
  is_active               boolean NOT NULL DEFAULT true,
  idempotency_key         varchar(100),                              -- supplied on initial POST; null on artifacts created indirectly
  idempotency_expires_at  timestamptz,                               -- service-layer enforces window
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);
CREATE UNIQUE INDEX idx_project_artifacts_one_active
  ON project_artifacts(project_id) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX idx_project_artifacts_user ON project_artifacts(user_id);
CREATE INDEX idx_project_artifacts_call ON project_artifacts(call_id);
-- Idempotency: plain UNIQUE on (user_id, idempotency_key) where key is non-null.
-- The 24h window is enforced in service logic by comparing idempotency_expires_at to now()
-- at request time (the partial-index-with-now() approach is rejected by Postgres because
-- now() is not immutable). Expired keys may still occupy the row; an offline reaper job
-- nulls idempotency_key when idempotency_expires_at < now() - interval '1 hour' so the
-- slot becomes reusable.
CREATE UNIQUE INDEX idx_project_artifacts_idempotency
  ON project_artifacts(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- One per generation invocation. Multiple per artifact possible (e.g., regenerate-all).
-- Idempotency lives on project_artifacts, not here: the initial POST is what gets de-duped,
-- and a run only exists once an artifact has progressed past needs_input / needs_call_selection.
CREATE TABLE generation_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id              uuid NOT NULL REFERENCES project_artifacts(id),
  user_id                  uuid NOT NULL REFERENCES users(id),
  status                   generation_run_status_enum NOT NULL DEFAULT 'queued',
  intent_snapshot          jsonb NOT NULL,
  selected_call_id         uuid REFERENCES calls_for_proposals(id),
  section_count            integer NOT NULL,
  sections_done            integer NOT NULL DEFAULT 0,
  model_config             jsonb NOT NULL,                 -- {model, maxTokens, temperature, ...}
  prompt_version           varchar(50) NOT NULL,
  next_event_sequence      bigint NOT NULL DEFAULT 1,      -- atomic allocator for generation_run_events.sequence
  locked_by                varchar(100),                   -- worker id
  locked_until             timestamptz,
  heartbeat_at             timestamptz,
  recovery_count           integer NOT NULL DEFAULT 0,
  started_at               timestamptz,
  completed_at             timestamptz,
  error_code               varchar(50),
  error_message            text
);
CREATE INDEX idx_generation_runs_status ON generation_runs(status, heartbeat_at);
CREATE INDEX idx_generation_runs_artifact ON generation_runs(artifact_id);

-- Durable SSE event store. Single source of truth for run timeline.
-- Sequence numbers are allocated atomically via generation_runs.next_event_sequence
-- (row-locked UPDATE ... SET next_event_sequence = next_event_sequence + 1 ... RETURNING).
-- This makes parallel section workers safe: each worker calls allocateSequence(runId)
-- before INSERTing into this table, so two concurrent emissions cannot collide on the
-- UNIQUE(run_id, sequence) constraint.
CREATE TABLE generation_run_events (
  id          bigserial PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES generation_runs(id),
  sequence    bigint NOT NULL,            -- monotonic per run; allocated via row-locked UPDATE
  event_type  varchar(50) NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_generation_run_events_seq ON generation_run_events(run_id, sequence);
CREATE INDEX idx_generation_run_events_run_time ON generation_run_events(run_id, created_at);

-- Section content. Replaces agent_sections.
-- The composite UNIQUE CONSTRAINT (artifact_id, section_key) is the FK target for
-- artifact_section_versions and artifact_placeholders below.
CREATE TABLE artifact_sections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id         uuid NOT NULL REFERENCES project_artifacts(id) ON DELETE CASCADE,
  section_key         varchar(100) NOT NULL,
  title               varchar(500) NOT NULL,
  display_order       integer NOT NULL,
  status              artifact_section_status_enum NOT NULL DEFAULT 'queued',
  markdown            text,
  generation_meta     jsonb,                                -- {model, latencyMs, tokenUsage, sourcesUsed[]}
  generation_run_id   uuid REFERENCES generation_runs(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_artifact_sections_natural UNIQUE (artifact_id, section_key)
);
CREATE INDEX idx_artifact_sections_run ON artifact_sections(generation_run_id);

-- Immutable version history. Written on every change.
-- Composite FK to artifact_sections(artifact_id, section_key) prevents orphan versions.
CREATE TABLE artifact_section_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id         uuid NOT NULL,
  section_key         varchar(100) NOT NULL,
  version_number      integer NOT NULL,
  status_at_snapshot  artifact_section_status_enum NOT NULL,
  markdown            text NOT NULL,                        -- only ready/edited outcomes snapshotted
  generation_meta     jsonb,
  created_by          uuid REFERENCES users(id),            -- null for system
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (artifact_id, section_key)
    REFERENCES artifact_sections(artifact_id, section_key) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_artifact_section_versions_unique
  ON artifact_section_versions(artifact_id, section_key, version_number);

-- Placeholders. Value folded in (no separate _values table for v1).
-- Composite FK to artifact_sections(artifact_id, section_key) prevents orphan placeholders.
CREATE TABLE artifact_placeholders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id     uuid NOT NULL,
  section_key     varchar(100) NOT NULL,
  placeholder_id  varchar(100) NOT NULL,                    -- the {{id}} token
  label           varchar(500) NOT NULL,
  description     text NOT NULL,
  type            placeholder_type_enum NOT NULL,
  required        boolean NOT NULL DEFAULT true,
  value_json      jsonb,                                    -- nullable until user fills
  file_ref        text,                                     -- nullable, GCS path for type=file
  filled_by       uuid REFERENCES users(id),
  filled_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (artifact_id, section_key)
    REFERENCES artifact_sections(artifact_id, section_key) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_artifact_placeholders_unique
  ON artifact_placeholders(artifact_id, section_key, placeholder_id);
```

### 5.2 New enums

```sql
CREATE TYPE artifact_status_enum AS ENUM
  ('pending_input', 'pending_call_selection', 'generating', 'ready', 'partial_failed', 'failed');

CREATE TYPE generation_run_status_enum AS ENUM
  ('queued', 'running', 'ready', 'partial_failed', 'failed');

CREATE TYPE artifact_section_status_enum AS ENUM
  ('queued', 'generating', 'ready', 'edited', 'failed');

CREATE TYPE placeholder_type_enum AS ENUM
  ('text', 'number', 'date', 'file');
```

### 5.3 Schema invariants enforced at the application layer

- Every Qdrant point's payload has `call_id` (UUID) + `call_code` — enforced by re-ingest script + a periodic CI test sampling 1 % of points
- Every `artifact_sections.section_key` matches a known key from `section-specs.ts` OR an entry in the per-call override list — validated at service-layer write
- `project_artifacts.status` and `generation_runs.status` advance monotonically (no reversal from terminal states) — enforced in the service layer
- `artifact_placeholders.value_json` typed-validated against `placeholder.type` before write (text → string, number → finite number, date → ISO 8601, file → `{path, mime, size, uploadedAt}` object)
- Every `{{token}}` in `artifact_sections.markdown` has a matching `artifact_placeholders` row at write time
- Single-active-artifact invariant enforced by **service layer** in a single transaction: `createArtifact(projectId)` (a) `UPDATE project_artifacts SET is_active=false WHERE project_id=$1 AND is_active=true` then (b) `INSERT ... is_active=true`. The partial unique index is the safety net; the service is the contract. No DB trigger, so the behavior is testable in isolation and explicit in the code path.
- On resume after `needs_call_selection`, `selectedCallId` MUST be present in `project_artifacts.candidates`. Service-layer rejection on miss returns 400 with `INVALID_CALL_SELECTION`. After successful resume, `candidates` is set to `null` to prevent reuse.
- Failed intent extraction (provider error, timeout, schema mismatch) writes the artifact row with `status='failed'` AND `is_active=false`. The row exists for audit but is excluded from `/panou` and from any "active project" listing. Listings query `project_artifacts WHERE is_active=true AND status NOT IN ('failed')` or join through `projects` and filter via the partial unique index. Audit views may opt into inactive rows explicitly.

### 5.4 Tables to retire (compatibility window → drop)

| Table | M4 behavior | M5 behavior |
|---|---|---|
| `agent_sessions` | frozen for writes; read-only via legacy compatibility adapter (see §10 M2 step 6.5 below) | GCS backup → drop |
| `agent_messages` | frozen for writes; not read by adapter (chat history is not surfaced in artifact view) | GCS backup → drop |
| `agent_turns` | frozen for writes; not read by adapter | GCS backup → drop |
| `agent_sections` | frozen for writes; read by adapter — maps `acceptedContent` → artifact-shape `markdown`, status `'ready'`, no placeholders | GCS backup → drop |
| `project_documents` | frozen for writes; read-only until artifact-backed export proven equivalent on sample | **Separate migration after parity confirmed** |

Enums dropped with their tables: `agent_phase`, `agent_session_status`, `runtime_mode`.

Feature flags deleted on M4: `chat_tools_trimmed`, `v3_chat_model_sonnet`, `managed_agent_enabled`, `managed_agent_writes_enabled`, `deterministic_preselect_enabled`, `v3_prompt_cache_enabled`, `generate_section_endpoint_enabled`, `preselect_no_auto_send`, `deterministic_actions_enabled`.

## 6. API contracts (detailed)

### 6.1 POST /api/v1/projects/generate

**Initial request:**
```http
POST /api/v1/projects/generate
Content-Type: application/json
X-CSRF-Token: ...

{ "idea": "...", "idempotencyKey": "client-uuid" }
```

**Resume after `needs_input`:**
```json
{ "artifactId": "...", "clarifications": { "orgType": "srl", "region": "NV" } }
```

**Resume after `needs_call_selection`:**
```json
{ "artifactId": "...", "selectedCallId": "uuid" }
```

**Invalid payload combinations (400):**
- `idea` AND `artifactId` both present
- `clarifications` AND `selectedCallId` both present
- `selectedCallId` not in the artifact's stashed `candidates` list

**Responses (200):**
```json
{ "status": "needs_input", "artifactId": "...", "missing": ["orgType", "region"], "questions": [
  { "field": "orgType", "label": "...", "options": ["srl", "pfa", ...] },
  { "field": "region", "label": "...", "options": ["NV", "NE", ...] }
]}

{ "status": "needs_call_selection", "artifactId": "...", "candidates": [
  { "id": "uuid", "code": "PNRR/...", "title": "...", "score": 0.78, "why": "..." }
]}

{ "status": "running", "generationRunId": "uuid", "eventsUrl": "/api/v1/projects/generate/runs/{id}/events" }

{ "status": "failed", "artifactId": "...", "error": { "code": "no_match" | "extraction_failed" | ..., "message": "..." } }
```

**Concurrency (409):**
```json
{ "error": { "code": "ACTIVE_RUN_EXISTS", "activeRunId": "uuid", "message": "..." } }
```

### 6.2 GET /api/v1/projects/generate/runs/{runId}/events

```
Headers:
  Accept: text/event-stream
  Last-Event-ID: 42      (optional)

Response: text/event-stream

id: 1
event: run_started
data: {"runId":"...","sectionCount":11}

id: 2
event: section_started
data: {"sectionKey":"context","title":"..."}

id: 3
event: section_completed
data: {"sectionKey":"context","markdown":"...","placeholders":[...]}

...

event: artifact_ready
data: {"artifactId":"..."}
```

Event types: `run_started`, `section_started`, `section_completed`, `section_failed`, `artifact_ready`, `artifact_ready_partial`, `run_failed`. Each payload is fully self-describing — no overloaded type with conditional content.

### 6.3 GET /api/v1/projects/generate/runs/{runId}

Returns the current snapshot:
```json
{
  "run":      { "id", "status", "sectionCount", "sectionsDone", "startedAt", "completedAt", "errorCode", "errorMessage" },
  "artifact": { "id", "projectId", "status", "title", "intent", "callId", "callCode", "callTitle", "isActive" },
  "sections": [ { "id", "sectionKey", "displayOrder", "status", "markdown", "generationMeta" } ],
  "placeholders": [ { "id", "sectionKey", "placeholderId", "label", "description", "type", "required", "value_json", "filledAt" } ]
}
```

The in-app artifact view is a thin renderer over this single snapshot. No per-section fetches.

### 6.4 Post-generation routes

```
PUT  /api/v1/projects/{projectId}/placeholders/{phId}
  body: { value }
  - validates value against placeholder.type
  - writes value_json, filled_by, filled_at, updated_at
  - returns updated artifact snapshot

POST /api/v1/projects/{projectId}/sections/{sectionKey}/regenerate
  - rejects if artifact.status != 'ready' and != 'partial_failed' (no concurrent run)
  - snapshots current section to artifact_section_versions
  - sets section.status = 'generating'
  - runs one zero-tool model call with intent + call_blueprint + section_spec + filled_placeholders + prior_accepted_sections
  - reconciles placeholders:
      same id+label → reuse with existing value
      new id        → insert with value=null
      removed id    → soft-orphan (warn flag in response, value preserved until next regen confirms removal)
  - returns updated section + placeholders

PUT  /api/v1/projects/{projectId}/sections/{sectionKey}/content
  body: { markdown }
  - rejects if artifact.status != 'ready' and != 'partial_failed'
  - snapshots current to artifact_section_versions
  - updates section.markdown, section.status = 'edited'
  - re-scans tokens: existing placeholders still referenced → keep; orphans → warn but preserve
  - returns updated section

GET  /api/v1/projects/{projectId}/export?format=docx|md
  - loads artifact read model (artifact + sections + filled placeholders)
  - substitutes filled tokens; renders unfilled tokens as visibly highlighted markers
  - DOCX: pipes through lib/export/docx.ts
  - MD: concatenates sections with H1 titles + anchor IDs
  - partial_failed artifact behavior: ready and edited sections are rendered normally;
    failed sections are NOT omitted from the document — they appear in their display_order
    position as a short generated warning block (Romanian/English per artifact locale):
      "⚠ Această secțiune nu a putut fi generată. Folosiți butonul «Regenerează»
       din vizualizatorul proiectului pentru a încerca din nou."
    Export does not block on partial_failed; the warning surfaces the gap in the output itself.
```

## 7. Intent schema

### 7.1 Essential fields (gate generation)

```ts
{
  // Must match the DB orgTypeEnum exactly (app/src/lib/db/schema.ts:9).
  // Extractor normalizes free-text inputs ("microîntreprindere", "firma mea SRL", etc.)
  // to one of these values. Unknown inputs surface as null → triggers needs_input.
  orgType: "srl" | "sa" | "pfa" | "ong" | "uat" | "institutie_publica" | "altul" | null;
  region:  string | null;                  // normalized NUTS-2 code
  projectDescription: string | null;
}
```

If any essential field is null after extraction, the API returns `needs_input` with a form requesting only the missing essentials.

### 7.2 Helpful fields (non-blocking, used for ranking)

```ts
{
  orgSize: "micro" | "mica" | "medie" | "mare" | null;
  caen: string | null;                                                 // 4-digit CAEN code
  budgetEstimate: { min?: number; max?: number; currency?: "RON" | "EUR" } | null;
  projectType: string | null;                                          // free-form, fed to semantic search
}
```

### 7.3 Extractor responsibilities

- Single Sonnet tool call: `extract_intent({ idea: string }) → IntentSchema`
- Normalizes free-text region / county / city → NUTS-2 code when unambiguous; asks only if it cannot
- `orgType` values must match the DB `orgTypeEnum` exactly — verified against the enum at write time; unknown tokens dropped or mapped before persistence
- Returns `null` for any field it cannot extract confidently rather than guessing

## 8. Call matching

### 8.1 Two-stage algorithm

```
Stage A — Deterministic DB filter:
  SELECT * FROM calls_for_proposals
  WHERE status = 'deschis'           -- callStatusEnum: ['previzionat','deschis','in_evaluare','inchis','anulat']
                                     -- 'deschis' = currently accepting submissions; the only matchable status for v1.
                                     -- Configurable via env MATCH_INCLUDE_STATUSES if planning/upcoming calls matter later.
    AND submission_end > now()
    AND (eligible_types IS NULL OR intent.orgType = ANY(eligible_types))
    AND (eligible_regions IS NULL OR intent.region = ANY(eligible_regions))
    AND (intent.caen IS NULL OR eligible_caen IS NULL OR intent.caen = ANY(eligible_caen))
    AND (intent.budgetEstimate.min IS NULL OR budget_total >= intent.budgetEstimate.min)

Stage B — Semantic rank over Qdrant:
  qdrant.search(
    query_text: intent.projectDescription || intent.projectType,
    filter: { call_id: { $in: surviving_call_ids_from_stage_A } },
    limit: 20
  )
  → group by call_id, take max score per call

Combine:
  score = 0.7 * semantic_score + 0.3 * filter_strength
  Sort by combined score desc.

Decision:
  if top1.score - top2.score > ε (default 0.05):
    return { kind: 'selected', call_id: top1.call_id, call_code, title }
  elif top3 exist:
    return { kind: 'ambiguous', candidates: top3 }
  else:
    return { kind: 'no_match' }
```

`ε` configured via env, default `0.05`. Returns canonical UUID in every code path; no string IDs leak.

## 9. Section generation

### 9.1 Section spec resolution

```
sectionList = section_specs.DEFAULTS                                 // 11 specs from section-specs.ts
overrides   = callKnowledge.normalized.sectionOverrides ?? {}        // per-call optional; nested under existing normalized jsonb
sectionList = applyOverrides(sectionList, overrides)
  // overrides may: drop a section, add a custom section, change dependsOn / displayOrder
```

The `callKnowledge` row is loaded by canonical UUID match: `WHERE canonical_call_id = $1`. The schema's existing `normalized jsonb` (default `{}`) is the home for `sectionOverrides`; no new column required.

### 9.2 Per-section generation contract

Single Anthropic tool call per section:

```ts
generate_section({
  intent: IntentSchema,
  callBlueprint: CallBlueprint,
  sectionSpec: SectionSpec,
  filledPlaceholders: Record<string, PlaceholderValue>,   // empty on initial generation; populated on regenerate
  outline?: GlobalOutline,                                 // optional, deterministic — not sibling-section content
})
  → tool call returns:
{
  markdown: string,                       // may contain {{placeholder_id}} tokens
  placeholders: Array<{
    id: string;                           // snake_case, unique within section (e.g., "company_revenue_2023")
    label: string;                        // short user-facing name
    description: string;                  // what the user must provide
    type: "text" | "number" | "date" | "file";
    required: boolean;
    sectionId: string;                    // matches the section being generated
  }>
}
```

### 9.3 The 7 placeholder enforcement rules

1. Every `{{placeholder_id}}` in `markdown` must have one matching entry in `placeholders[]`
2. Every entry in `placeholders[]` must appear at least once in `markdown` (unless explicitly checklist-only — flagged via metadata field, not v1)
3. Placeholder IDs are stable, lowercase, deterministic when possible (so regeneration preserves user-filled values via id-match)
4. Placeholders are used only for missing user-supplied facts — NOT for weak model confidence on its own claims
5. Stored alongside the section draft (`artifact_placeholders` table), not as a separately-inferred artifact
6. DOCX / .md export substitutes filled tokens with values; unfilled tokens render as visibly highlighted markers
7. The in-app checklist is generated from the sidecar, not scraped from prose

Validation enforced at the service-layer write to `artifact_sections` + `artifact_placeholders`. Tool-call responses that fail validation either fail the section (status=`failed`, error captured in event log) or are retried once depending on the failure class.

### 9.4 Concurrency & retry

- Parallel section calls bounded by env `GENERATION_PARALLELISM` (default `4`)
- Per-section timeout: env `GENERATION_TIMEOUT_PER_SECTION_MS` (default `90000`)
- Per-run timeout: env `GENERATION_RUN_TIMEOUT_MS` (default `300000`)
- One automatic retry per section on transient failures (HTTP 429, 5xx, network reset, request timeout) with short backoff + jitter
- Validation failures (schema mismatch, missing sidecar, etc.) fail immediately — no retry
- Worker heartbeat every ~10 s; stale lease threshold = 60 s

## 10. Migration & cutover sequencing

### M1 — Canonical call identity repair

**New scripts** under `app/scripts/`:

1. **`audit-qdrant-call-identity.ts`** — read-only audit of the configured Qdrant collection. Classifies each point:
   - `resolved` (payload.call_id is a UUID in calls_for_proposals.id)
   - `resolvable_by_code` (payload.call_code matches calls_for_proposals.call_code)
   - `resolvable_by_external_id` (matches another known identifier)
   - `orphan` (no resolution path)
   Outputs counts + sample IDs + a full JSON audit artifact. No mutations.

2. **`patch-qdrant-payloads.ts`** — consumes the audit, patches resolvable points to add canonical `call_id` UUID + `call_code` payload fields. Tags orphans with `orphan: true`. Idempotent. `--dry-run` / `--confirm` gate.

3. **`backfill-call-knowledge-ids.ts`** — populates a new `canonical_call_id uuid REFERENCES calls_for_proposals(id)` column on `call_knowledge`, resolving from the existing `call_id text` via the same audit-output mapping used by the Qdrant patcher. Backs up rows before migration. `--dry-run` / `--confirm` gate. Schema migration paired with the script: `ALTER TABLE call_knowledge ADD COLUMN canonical_call_id uuid REFERENCES calls_for_proposals(id); CREATE INDEX idx_call_knowledge_canonical ON call_knowledge(canonical_call_id);`. The text `call_id` column stays for one observation window after M2 then is dropped in a follow-up migration once code reads canonical_call_id exclusively.

**Modified script:**
- `bulk-ingest-rag-knowledge.ts` — adds `--strict` mode (default ON post-M1). Every new chunk must reference an existing `calls_for_proposals` row by `id` or `call_code`. Fails loudly on miss.

**Gate criterion:**
- ≥99 % of legacy Qdrant points resolvable; remaining 1 % tagged `orphan=true` AND excluded from the `match()` search path
- **100 % of points reachable via the new matcher carry canonical `call_id` UUID**
- `call_knowledge.call_id` is UUID for ≥99 % of rows
- New `--strict` ingest fails closed on orphan test fixture

### M2 — Backend pipeline (no UI)

Build order:
1. Drizzle migration `0042_artifact_pipeline.sql` (six tables + four enums + indexes; plus the `call_knowledge.canonical_call_id` column added in M1's `backfill-call-knowledge-ids.ts` paired migration)
2. **Canonical identity helpers + assertions** — small library used by every consumer to enforce the M1 contract at the application layer
3. `lib/ai/intent/extract.ts`
4. `lib/calls/match.ts`
5. **Artifact read model / serializer** — single shape consumed by export, in-app view, replay endpoint
6. `lib/ai/section-generate.ts`
   6.5. **`lib/compat/legacy-session-adapter.ts`** — read-only function `getLegacyArtifactView(sessionId)` that synthesizes an artifact-shape JSON from `agent_sessions` + `agent_sections.acceptedContent` (status mapped: accepted → ready; others → ignored). No writes. Consumed by `/proiecte/[id]` when the URL points to a legacy ID and no `project_artifacts` row exists for the project. Tested in `legacy-adapter.test.ts`.
7. `lib/ai/generation-run.ts` (worker lease, bounded parallelism, retry, event emission)
8. `lib/ai/run-recovery.ts`
9. `lib/placeholders/render.ts`
10. Export adapters — `lib/export/docx.ts` adaptation, then `lib/export/markdown.ts` (new)
11. API routes (`POST /generate`, `GET /runs/:id`, `GET /runs/:id/events`, `PUT /placeholders/:id`, `POST /sections/:sk/regenerate`, `PUT /sections/:sk/content`, `GET /export`)
12. Vitest suite (unit + integration; see §11)

**Gate criterion:**
- Vitest integration suite green
- Manual curl run produces a valid DOCX for `godjabogdan@gmail.com`
- `worker-recovery.test.ts` integration passes (lease expiry → another worker resumes)

### M3 — Frontend replacement

**New components / pages:**
- `app/[locale]/(dashboard)/proiecte/nou/page.tsx` (replaces existing)
- `app/[locale]/(dashboard)/proiecte/[id]/page.tsx` (artifact view, replaces placeholder)
- `components/artifact/IdeaForm.tsx`
- `components/artifact/ClarificationForm.tsx`
- `components/artifact/CallSelectionPicker.tsx`
- `components/artifact/GenerationProgress.tsx` (SSE consumer)
- `components/artifact/ArtifactView.tsx`
- `components/artifact/PlaceholderChecklist.tsx`
- `components/artifact/SectionCard.tsx` (replaces agent version)

**Surfaces to update:**
- Dashboard / project cards switch from `agent_sessions` queries to `project_artifacts`
- `/asistent-ai` page becomes a redirect to `/proiecte/nou`
- Sidebar, mobile nav, command palette, help panel, not-found page — all `/asistent-ai` links updated
- `/proiecte/[id]/sectiuni/[sectionId]` — either artifact-backed render or redirect to artifact view
- Project detail page stops reading from `project_documents`; reads from `artifact_sections` instead

**Components to delete (replaced):**
- `AgentWorkspace`, `AgentConversation`, `OutlineView`, `BlueprintCard`, `EligibilityCard`, old `SectionCard`, `ValidationSummary`, `WarningsBar`

**Gate criterion:**
- Playwright E2E suite green
- Manual smoke on real account → produces real DOCX
- Allowlist-based grep verifies no UI navigation link still points to retired routes (allowing the redirect implementation page itself to exist)

### M4 — Legacy freeze (Phase 1 of compatibility window)

- `MANAGED_RUNTIME_ENABLED=false` permanently in `cloudbuild.production.yaml`
- All listed feature flags deleted from `feature_flags` table
- Retired API routes (`/api/ai/agent`, `/api/ai/agent/sessions/*`, `/api/ai/agent/state`, `/api/v1/agent-sessions/*`, `/api/v1/projects/preselect`) return **HTTP 410 Gone** with a JSON deprecation notice
- Retired frontend routes redirect:
  - `/asistent-ai` → `/proiecte/nou`
  - Stale agent-session URLs → mapped artifact/project compatibility page when mappable, otherwise a generic deprecation page
- Legacy read adapter remains available for compatibility renders of existing user data

**Gate criterion (M4 → M5 readiness, Phase 2):**
- Cloud Run logs (filtered to exclude health probes, monitoring agents, and known operator scripts) show **zero non-internal requests to retired API routes for 48 consecutive hours**

### Phase 3 — GCS backup

After M4 gate is met, before any drop migration:
- `gcloud sql export sql ... agent_sessions agent_messages agent_turns agent_sections` → GCS
- For `project_documents`: **dry-run the artifact/compat adapter against a sample of legacy projects, confirm parity, get explicit operator sign-off**

### M5 — Drop

Two **separate** Drizzle migrations, executed when their independent criteria are met:

- `0043_drop_agent_tables.sql` — drops `agent_sessions`, `agent_messages`, `agent_turns`, `agent_sections`, and the `agent_phase` / `agent_session_status` / `runtime_mode` enums. Criteria: ≥30 days since M4, zero reads in trailing 7-day window (`pg_stat_user_tables`), operator approval.
- `0044_drop_project_documents.sql` — drops `project_documents`. **Separate criteria:** all exports and project views have been artifact-backed for the full Phase-2 observation window; sample-project parity confirmed via the dry-run adapter; operator manual approval.

Repository sweep coincident with M5:
- Delete `lib/ai/agent/` entirely
- Delete frontend agent components
- Delete `lib/workspace.ts` (compatibility layer ends with M5)
- Delete research MCP tool source files

## 11. Testing strategy

### 11.1 Unit tests — `app/tests/unit/`

| Module | Coverage |
|---|---|
| `intent/extract.test.ts` | tool-call shape; NUTS-2 normalization; orgType taxonomy alignment; missing-essential detection |
| `calls/match.test.ts` | deterministic filter; Qdrant rank ordering; ambiguity epsilon; no-match boundary; canonical UUID returned in every path |
| `ai/section-generate.test.ts` | the 7 placeholder enforcement rules; markdown shape; token format |
| `ai/generation-run.test.ts` | bounded concurrency; event sequence ordering; lease acquisition + heartbeat; one auto-retry on transient; immediate fail on validation; idempotency window |
| `ai/run-recovery.test.ts` | stale lease detection; queued reset; recovery_count increment |
| `placeholders/render.test.ts` | substitution per type; unfilled highlighting; nested-token rejection; sidecar mismatch rejection |
| `export/docx.test.ts` | filled / unfilled token rendering; DOCX structural validity; section order + titles |
| `export/markdown.test.ts` | section concat; anchor IDs; token preservation |

### 11.2 Integration tests — `app/tests/integration/`

End-to-end through real Postgres + stubbed provider. Each is one user-visible scenario:

- `intent-to-match.test.ts`
- `pipeline-happy-path.test.ts` (full 11 sections → artifact_ready)
- `pipeline-needs-input.test.ts`
- `pipeline-needs-call-selection.test.ts`
- `pipeline-section-failure.test.ts` (partial_failed → post-gen regenerate recovers)
- `pipeline-all-fail.test.ts`
- `worker-recovery.test.ts` (lease expiry → resume)
- `worker-race.test.ts` **(NEW)** — two workers attempt to claim the same run/section concurrently; only one wins
- `sse-replay.test.ts`
- `idempotency.test.ts` (same key within 24 h returns same run; after `idempotency_expires_at`, fresh key required)
- `concurrency-limits.test.ts` (second POST while running → 409)
- `multi-user-concurrency.test.ts` **(NEW)** — two users each have one active run concurrently; no cross-user event leakage in SSE replay
- `placeholder-fill-and-regen.test.ts`
- `auth-isolation.test.ts` **(NEW)** — user A cannot read/update/export user B's artifact, run events, placeholders, or sections (every new route covered)
- `active-artifact-lifecycle.test.ts` **(NEW)** — creating new active artifact deactivates prior; only one active per project; old artifacts directly addressable
- `post-generate-contract.test.ts` **(NEW)** — POST contract matrix: initial, resume-clarifications, resume-call, invalid mixed payload (400), invalid `selectedCallId` outside stashed candidates (400)
- `export-edges.test.ts` **(NEW)** — partial-failed artifact export behavior; edited section export; filled / unfilled placeholder rendering in both DOCX and MD
- `legacy-adapter.test.ts`

### 11.3 E2E tests — `app/e2e/artifact/`

- `idea-to-export.spec.ts` (full happy path including DOCX download + OOXML signature check)
- `needs-input-flow.spec.ts`
- `recovery.spec.ts` (disconnect mid-run → SSE replay via `Last-Event-ID`)
- `legacy-redirect.spec.ts` (M4 redirects work)
- `route-retirement.spec.ts` **(NEW)** — old API routes return 410; frontend routes redirect
- `keyboard-smoke.spec.ts` **(NEW)** — basic keyboard / focus traversal of idea form, clarification form, call picker, placeholder checklist

### 11.4 Per-milestone gates

| Milestone | Gate criterion |
|---|---|
| **M1** | Audit reports ≥99 % legacy resolvability; orphans tagged AND excluded from match path; 100 % canonical UUID for points reachable via the new matcher; `call_knowledge.call_id` UUID for ≥99 % of rows; `--strict` ingest rejects orphan fixture |
| **M2** | Vitest integration suite green; manual curl run produces valid DOCX for `godjabogdan@gmail.com`; worker-recovery + worker-race tests pass |
| **M3** | Playwright E2E suite green; manual smoke on real account; allowlist-based grep — no UI nav link points to retired routes (redirect-implementation pages excluded) |
| **M4** | Cloud Run logs (excluding probes / monitoring / operator scripts) show zero non-internal requests to retired API routes for 48 consecutive hours |
| **M5 (agent tables)** | ≥30 days since M4; zero reads against legacy tables in trailing 7-day window; operator approval |
| **M5 (project_documents)** | Export/read-adapter dry-run on sample of legacy projects confirms parity; explicit operator sign-off |

### 11.5 Deliberately not in v1

- Multi-user load testing beyond the per-user concurrency cap
- Cross-provider failover
- Long-document stress (>50 k section markdown)
- Localization beyond `ro` / `en`
- Automated accessibility audit (manual a11y pass in M3 + Playwright keyboard/focus smoke is the v1 floor)

## 12. Configuration & env vars

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_DRAFTING_MODEL` | `claude-sonnet-4-6` | Drafting model. Per-run snapshot stored in `generation_runs.model_config`. |
| `ANTHROPIC_INTENT_MODEL` | `claude-sonnet-4-6` | Intent extractor model. Same model in v1; separable later if cost-routed. |
| `GENERATION_PARALLELISM` | `4` | Max concurrent section calls per run. |
| `GENERATION_TIMEOUT_PER_SECTION_MS` | `90000` | Per-section budget. |
| `GENERATION_RUN_TIMEOUT_MS` | `300000` | Per-run hard cap. |
| `MATCH_AMBIGUITY_EPSILON` | `0.05` | Top-1 vs top-3 boundary. |
| `IDEMPOTENCY_WINDOW_HOURS` | `24` | `idempotency_expires_at = now() + this`. |
| `WORKER_LEASE_TTL_SECONDS` | `300` | Hard claim duration before another worker may re-claim. |
| `WORKER_HEARTBEAT_INTERVAL_SECONDS` | `10` | Heartbeat cadence. |
| `WORKER_STALE_THRESHOLD_SECONDS` | `60` | Lease considered stale if `heartbeat_at < now() - this`. |
| `QDRANT_COLLECTION_NAME` | `eu_legislation` | Configured per environment; do not hard-code in code. |

## 13. Glossary

- **Artifact** — One AI-generated proposal attempt (`project_artifacts` row). N:1 with `projects`. Always belongs to one user, one org, one (optional, eventually-resolved) call.
- **Run** — One generation invocation against an artifact (`generation_runs` row). Multiple runs per artifact possible (regenerate-all, retry).
- **Section** — One bounded chapter of the proposal (`artifact_sections` row). 11 defaults + per-call overrides. Each has its own status, markdown, placeholders.
- **Placeholder** — A `{{token}}` in section markdown plus a sidecar entry (`artifact_placeholders` row) declaring what the user must provide. Value folded into the row in v1.
- **Idempotency key** — Client-supplied UUID on initial POST. Same key within 24 h returns the same run.
- **Lease** — Worker's exclusive claim on a run (`locked_by` + `locked_until` + `heartbeat_at`). Stale leases reclaimable by recovery scanner.

## 14. Open questions for the implementation plans

Resolved during brainstorm; flagged here only so they don't get lost during writing-plans:

- The exact NUTS-2 normalization library / lookup data — verify whether a Romanian-specific gazetteer is bundled or external API. (M2-step-3 spike, ~2 hours.)
- DOCX placeholder highlight style — exact OOXML attributes (yellow shading? square brackets? both?) to be designed during M2-step-10. UX-cheap, infra-trivial.
- Per-call section overrides JSON schema inside `callKnowledge.normalized.sectionOverrides` — finalize during M2-step-2 (canonical identity helpers); not a v1 blocker since the 11 defaults work alone when no override is present.

## 15. References

- Audit findings traced today (2026-05-15): silent V3 turn termination (`runtime.ts:631`), schema drift on `projects.completion_status` (migration 0040), hash-vs-UUID call identity gap, Opus 4.6 cost on chat loop (decoupled via `v3_chat_model_sonnet` flag for the interim window).
- Reused proven leaves: `app/src/lib/ai/agent/section-specs.ts` (11 defaults), `app/src/lib/export/docx.ts` (OOXML builder), `app/src/app/api/v1/projects/[id]/export/route.ts` (export endpoint baseline), `app/src/lib/vectors/store.ts` (Qdrant + memory dual backend), `app/src/lib/projects/promotion.ts:79` (`deriveProjectTitle`).
- Retired surface: `app/src/lib/ai/agent/runtime.ts`, `app/src/lib/ai/agent/managed/`, `app/src/lib/ai/agent/mcp/`, most of `app/src/lib/ai/agent/services/`, all `app/src/components/agent/*` components.

---

**End of spec.** Implementation plans (M1, M2, M3) will be produced via the writing-plans skill after user review of this document.
