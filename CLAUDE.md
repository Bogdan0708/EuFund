# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FondEU (PlatformaFinantare.eu) — AI-powered platform for Romanian organizations to prepare EU funding applications. Built with Next.js 14 App Router, TypeScript, Drizzle ORM + PostgreSQL (postgres.js driver), NextAuth v5 beta, next-intl (ro/en).

## Local development

Docker compose brings up the dev stack (ports exposed to host):
- `eu-funds-postgres-1` — postgres on `5433`
- `eu-funds-redis-1` — redis on `6380` (required for `/api/ai/*`; fail-closed)
- `eu-funds-qdrant-1` — optional, `6335` (only needed with `VECTOR_PROVIDER=qdrant`)

Required env in `app/.env.local` for a working dev loop:
- `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- `ADMIN_PASSWORD` — `seed-admin.ts` throws without it; same value must be in `PLAYWRIGHT_ADMIN_PASSWORD` for e2e
- `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` for AI flows
- `VECTOR_PROVIDER=memory` is the default (no Qdrant needed for most dev work)

Dev server: `cd app && npm run dev` binds port 3000. If another project is already on 3000, use `PORT=3002 npm run dev` and update `NEXTAUTH_URL` to match — auth callbacks break otherwise.

## Commands

All commands run from the `app/` directory:

```bash
# Development
npm run dev              # Start dev server (port 3000)
npm run build            # Production build
npm run lint             # ESLint (next lint)
npm run typecheck        # tsc --noEmit

# Tests (Vitest — unit + integration)
npm run test             # Run all tests once
npm run test:watch       # Watch mode
npx vitest run tests/integration/feature-flags.test.ts  # Single Vitest file

# E2E tests (Playwright — informational only, not a merge gate)
npx playwright test                                     # All E2E tests
npx playwright test e2e/auth/login.spec.ts              # Single spec
npx playwright test -g "login succeeds"                 # Filter by test name
# Requires: dev server running, REDIS_URL set, PLAYWRIGHT_ADMIN_PASSWORD set

# Database (Drizzle ORM)
npm run db:generate      # Generate migration from schema changes
npm run db:push          # Push schema directly (dev)
npm run db:migrate       # Run migrations (production, uses .env.production)
npm run db:studio        # Visual DB editor
npm run db:seed          # Seed data (dev, uses .env.local)

# Docker
npm run docker:build     # Build production image
npm run docker:run       # Run container (port 8080)
```

## Architecture

### Directory Layout

```
app/src/
├── app/
│   ├── [locale]/           # i18n wrapper (ro/en)
│   │   ├── (auth)/         # Public auth pages (autentificare, inregistrare, resetare-parola)
│   │   ├── (dashboard)/    # Protected app pages (panou, proiecte, finantari, etc.)
│   │   └── layout.tsx      # Root locale layout (NextIntlClientProvider, CSP nonce)
│   └── api/
│       ├── auth/           # NextAuth + register, verify-email, forgot/reset-password
│       ├── ai/             # AI endpoints (chat, agent)
│       ├── billing/        # Stripe (checkout, portal, pricing, info)
│       ├── v1/             # REST resources (organizations, projects, work-packages, admin)
│       ├── integrations/   # External APIs (eurlex, cordis, eurostat, onrc, qes)
│       └── webhooks/       # Stripe webhook handler
├── lib/
│   ├── db/schema.ts        # Drizzle schema (all tables, enums, relations)
│   ├── db/index.ts         # DB connection (lazy proxy + withUserRLS)
│   ├── auth/index.ts       # NextAuth config (Credentials provider, JWT strategy)
│   ├── auth/edge.ts        # Edge-safe session decode (manual JWT, no eval)
│   ├── auth/helpers.ts     # requireAuth(), requirePlatformAdmin(), requireOrgRole()
│   ├── errors/index.ts     # FondEUError, Errors factory, CircuitBreaker, withRetry
│   ├── legal/audit.ts      # logAudit() with tamper-evident SHA-256 hash chain
│   ├── legal/audit-integrity.ts  # verifyAuditChainIntegrity()
│   ├── legal/retention-cleanup.ts # DPIA retention policy enforcement
│   ├── feature-flags/index.ts     # isFeatureEnabled() with LRU cache
│   ├── middleware/          # auth.ts (withAIAuth), rate-limit.ts (withRateLimit)
│   ├── rules/eligibility.ts # Deterministic eligibility rules engine (no AI)
│   ├── monitoring/sentry.ts # Conditional Sentry init (only when SENTRY_DSN set)
│   ├── monitoring/metrics.ts # Prometheus-compatible metrics
│   ├── redis/client.ts     # ioredis lazy connection
│   ├── storage/gcs.ts      # Dual backend: GCS (production) + local FS (dev)
│   ├── security/nonce.ts   # getNonce() for server components
│   └── i18n.ts             # next-intl config (locales: ro, en; default: ro)
├── components/             # React components organized by domain
├── messages/               # ro.json, en.json (i18n strings)
└── middleware.ts            # Global edge middleware (CSP, CSRF, auth gates, email verification)
```

Tests live in `app/tests/` (not `src/`). Path alias: `@/*` maps to `app/src/*`.

### Key Patterns

**Error handling**: Use `FondEUError` from `@/lib/errors`. Factory methods: `Errors.validation(field, msgRo, msgEn)`, `Errors.notFound(type, id)`, `Errors.unauthorized()`, `Errors.forbidden()`, `Errors.rateLimited()`, `Errors.serviceUnavailable(service)`, `Errors.internal()`. Convert to response with `.toResponse(locale)`. All user-facing errors require bilingual messages.

**Auth helpers** (`@/lib/auth/helpers`):
- `requireAuth()` — returns `SessionUser` or throws 401
- `requirePlatformAdmin()` — **always verifies `isPlatformAdmin` against DB** (prevents stale-session privilege drift), throws 403
- `requireOrgRole(userId, orgId, minRole)` — checks org membership role hierarchy (admin > org_admin > project_manager > viewer)

**API route auth**: AI endpoints use `withAIAuth()` HOF which checks session, user tier, and Redis-based rate limits. Generic routes use `withRateLimit()`. Admin routes use `requirePlatformAdmin()`.

**DB lazy proxy** (`@/lib/db`): `db` is a `Proxy` that defers postgres connection to first property access. Required because Next.js build runs without `DATABASE_URL` in CI.

**Row-Level Security**: `withUserRLS(userId, fn)` wraps queries in a transaction that sets `app.current_user_id` session variable. RLS policies in `lib/db/rls.sql` enforce tenant isolation using this variable. The variable name must match exactly between code and SQL.

**CSRF**: Double-submit cookie pattern. Middleware sets `csrf-token` httpOnly cookie and `X-CSRF-Token` response header. Clients send token back in `X-CSRF-Token` request header. Constant-time comparison.
- **Client side**: state-changing POSTs from the browser (fetch to `/api/*`) must go through `csrfFetch` from `@/lib/csrf/client` — bare `fetch` returns 403 `CSRF_REQUIRED`. Example: `lib/preselect/client.ts`.

**CSP nonce**: Middleware generates `crypto.randomUUID()`, passes via `x-nonce` request header. Server components read via `getNonce()` from `@/lib/security/nonce`.

**Audit logging**: `logAudit()` from `@/lib/legal/audit`. Tamper-evident SHA-256 hash chain — each entry links to the previous via `previousHash`/`entryHash`. DLQ fallback ensures audit failures never crash requests. Verify chain with `verifyAuditChainIntegrity()`.

**Feature flags**: `isFeatureEnabled(key, ctx)` from `@/lib/feature-flags`. DB-backed with 60s LRU cache (max 500 entries). Supports tier targeting, userId targeting, and deterministic percentage rollout (MD5 hash). Fail-closed: unknown flags return `false`.

**Validation**: Zod for all request schemas, defined in `@/lib/validation/schemas.ts`. Key schemas: `extractedCallSchema`, `wizardMatchCallsSchema`. Types are inferred from schemas.

**Knowledge ingestion pipeline**: `lib/ai/knowledge/` — three-stage pipeline: `parser.ts` (PDF/Word → text) → `extractor.ts` (AI-powered structured extraction) → `ingestor.ts` (vector store/RAG ingestion). Triggered via `/api/admin/ingest-call` (multipart upload, 15MB max, PDF/DOCX/XLSX/TXT).

**Vector store / RAG**: `lib/vectors/store.ts` — abstraction over Qdrant (production) and in-memory (dev). Controlled by `VECTOR_PROVIDER` env var. Qdrant requires `QDRANT_URL` and `QDRANT_API_KEY`. Collection name defaults to `eu_legislation`. RAG pipeline in `lib/rag/pipeline.ts` — hybrid search (semantic + keyword boost), sentence-based chunking (1000 chars, 200 overlap), chunk validation against poisoning patterns, per-source token budgeting (500 tokens/source, 1600 total context).

**Crawler sources**: `lib/connectors/sources/config.ts` — currently 11 pre-configured web scraping targets for Romanian funding sources (3 national + 8 regional ADRs). Additional sources should be added only after manual review confirms they are worth operationalizing. Each source has CSS selectors, program detection keywords, and channel metadata.

**Password hashing**: bcryptjs with cost factor 12.

**Token TTLs**: Email verification = 24h, password reset = 1h.

**Client-side agent state** (`@/hooks/useAgent`): a hook that streams `/api/ai/agent` SSE events and exposes `{ messages, sessionId, phase, stateVersion, outlineFrozen, sendMessage, sendAction, adoptSession }`. When a server endpoint creates a session out-of-band (e.g. preselect's `/api/v1/projects/preselect`), the caller MUST `await agent.adoptSession(newSessionId)` before `agent.sendMessage(...)` — the hook mirrors `sessionId` into a `sessionIdRef` that `sendMessage` reads synchronously, bypassing the stale-closure trap of React's setState.

**`planning_artifact` versioning**: `agent_sessions.planning_artifact` is `jsonb` shared by V3 (`projectSummary`, `keyAssumptions`) and preselect (`preselect.version === 1`). Consumers must guard on the `version` field before reading a sub-object. Adding a new producer means bumping `version` (or adding a new top-level key) AND updating the narrow types in `lib/ai/knowledge/write-back.ts` / `lib/ai/agent/services/preselect.ts`.

### Agent Architecture

The primary AI interaction path. Three runtimes coexist in source; master currently uses two.

**V3 Agent** (`lib/ai/agent/`): state-machine agent with phases `discovery` → `research` → `structuring` → `drafting` → `review`. Each phase gates which MCP tools are available via the registry. Main entry: `POST /api/ai/agent`. Session state tracked in `agent_sessions` with `stateVersion` optimistic-concurrency tokens — all mutations use CAS. **Authoritative runtime today.**

**V3 turn-claim parity with managed.** All V3 entry paths claim via `claimTurn({...runtimeMode: 'v3'})` before `runAgentTurn` (helper: `claimV3OrConflict` in `route.ts`); on conflict returns JSON 409 with the same bilingual `conflict_request_id` envelope managed uses. `RuntimeOptions.turnId: string` is required; `runAgentTurn` calls `markTurnCompleted` immediately before each `done` emit (failed turns deliberately leave `completedAt` null — the cron's "abandoned" signal). `appendMessage` retries once on PG 23505 (intra-session sequence-number race), mirroring `appendManagedMessage`.

**Managed Agents** (`lib/ai/agent/managed/`): alternate runtime gated by `managed_agent_enabled` flag + `MANAGED_RUNTIME_ENABLED=true` env. Tool surface has four disjoint name sets in `tools.ts` — `READ_TOOL_NAMES` (10), `RULE_TOOL_NAMES` (5), `WRITE_TOOL_NAMES` (9), `PHASE_4_BLOCKED_TOOL_NAMES` (1, just `create_export_snapshot`). `getManagedTools(allowWrites)` returns 15 read+rules when writes are off, 24 when on. Writes are additionally gated by the `managed_agent_writes_enabled` rollout flag, which the runtime threads as `serviceCtx.allowWrites` to both the tool surface AND `buildManagedSystemPrompt`, so the model only sees writes when the flag is on. A runtime-level parallel-write cap allows at most one write tool call per assistant message; additional writes receive a synthetic `PARALLEL_WRITE_BLOCKED` tool_result without dispatch. The executor has an `allowWrites` gate as defense-in-depth. `save_call_blueprint` is a write tool with NO additional user-confirmation requirement (the deterministic preselect itself is the user signal); the executor case writes back to `agent_sessions.blueprint`/`currentPhase`/`stateVersion` after `saveCallBlueprint()`, gated by a conditional WHERE (`currentPhase = 'research' AND selectedCallId = args.callId`) so repeat calls in later phases are no-ops. Design spec: `docs/superpowers/specs/2026-04-10-managed-agents-phase3-design.md`.

**Preselect synthetic-evidence injection.** When `lookupBlueprint` cache-misses during preselect, top-15 evidence chunks are stashed in `planningArtifact.preselect.rawEvidence`. On the first managed turn for a research-phase preselected session, the runtime injects a synthetic `retrieve_evidence` tool_use + tool_result pair into in-memory history (NOT persisted to `agent_messages`) so the model sees evidence as if it had called the tool. The system prompt branches accordingly: branch 3a (with injection) tells the model NOT to call `get_call_blueprint` or `retrieve_evidence`; branch 3b (no injection — fallback for `lookupBlueprint` failure) keeps original behavior. Saves duplicate Qdrant searches per cold session. Gating: `phase === 'research' && selectedCallId !== null && rawEvidence.length > 0 && session.blueprint === null`.

**Tool-error text scrubbing** (`lib/ai/agent/managed/translator.ts`). Known executor error prefixes (`CONCURRENCY:`, `VALIDATION:`, `NOT_FOUND:`, `AUTHORIZATION:`, etc.) are stripped from assistant text deltas before they reach the SSE client, so the model can't leak raw payloads into its free-text response. The activity row separately renders localized error messages via stable executor prefixes (`useAgent.ts`).

**Deterministic preselect** (`lib/ai/agent/services/preselect.ts`, `POST /api/v1/projects/preselect`): server-side call selection + session bootstrap that replaces LLM-driven discovery for new projects. Four request modes: **rank** (no sessionId, no confirmCandidateId — runs the ranker), **confirm-new** (no sessionId + confirmCandidateId — creates a new session with the picked call), **override-rerank** (sessionId + expectedStateVersion — re-ranks on existing session), and **override-confirm** (sessionId + expectedStateVersion + confirmCandidateId — user picked from an override-mode ambiguous response; mutates the existing session, never creates a new one). Ranks top-5 calls by per-call vector similarity (pure max-score from `searchCalls`, which already dedupes). Three-branch decision policy: `selected` creates the session with `selectedCallId` + blueprint (when cached) + phase=`structuring` or `research`; `ambiguous` returns top-3 to the client without mutating state; `no_match` returns guidance without mutating state. Candidate list persists in `agent_sessions.planning_artifact` (versioned). Confirm modes validate the chosen callId via a three-prong existence probe before session creation/mutation (400 `INVALID_CALL_ID` on miss): filter on `metadata.callId`, filter on `metadata.sourceId`, then reproduce the picker's description-based search as the ultra-fallback. Override paths mutate via `setSelectedCall` (409 `OUTLINE_FROZEN` / `CONCURRENCY_CONFLICT` on policy/CAS failures); they omit `blueprintKind`/`phase` from the response because `setSelectedCall` does not change them. Feature-flagged on `deterministic_preselect_enabled` + `managed_agent_writes_enabled` + `managed_agent_enabled` + `MANAGED_RUNTIME_ENABLED=true` env var — any partial enablement would route to V3 silently, reintroducing discovery. Preselected sessions (`planning_artifact.preselect.version === 1`) fail closed with 503 `MANAGED_UNAVAILABLE` rather than degrade to V3 (structured actions are exempt — they bypass managed by design). Spec: `docs/superpowers/specs/2026-04-18-deterministic-preselect-design.md`.

**Service layer** (`lib/ai/agent/services/`): all V3 state mutations route through service functions, never direct DB writes. Key services: `application.ts`, `sections.ts`, `blueprint.ts`, `evidence.ts`, `freshness.ts`. Service errors: `NotFoundError`, `AuthorizationError`, `ValidationError`, `ConcurrencyError`.

**Policy matrix** (`lib/ai/agent/policy/matrix.ts`): declarative precondition rules for 8 mutations (`saveSectionDraft`, `approveSection`, `rollbackSection`, `rejectSection`, `markSectionStale`, `setSelectedCall`, `freezeOutline`, `setApplicationStatus`). Enforced by `assertPolicy()`. Bypassing the service layer breaks the audit chain — always mutate through services.

**MCP tools** (`lib/ai/agent/mcp/`): organized as `read/` (search-calls, get-call-blueprint, get-application-state, list-sections, get-section, get-validation-report, get-project-summary, list-uploaded-documents, retrieve-evidence), `rules/` (run-eligibility, validate-section, validate-application, check-missing-annexes, score-fit), `research/` (refresh-call-freshness, verify-deadline, check-call-page-updates). Tool availability is phase-gated by the registry.

**Senior Review primitive** (designed, not yet implemented): runtime-owned escalation at 4 high-stakes gates (call selection, outline freeze, eligibility verdict, section recovery). Spec: `docs/superpowers/specs/2026-04-14-senior-review-primitive-design.md`.

### Routing Conventions

- Romanian page paths: `/ro/autentificare`, `/ro/inregistrare`, `/ro/resetare-parola`, `/ro/panou`, `/ro/proiecte`
- Page routes use Romanian names in `(dashboard)` group: `panou` (dashboard), `proiecte` (projects), `finantari` (funding), `documente` (documents), `legislatie` (legislation), `setari` (settings)
- API routes use English: `/api/ai/*`, `/api/auth/*`, `/api/v1/*`
- Admin API routes: `/api/v1/admin/feature-flags`, `/api/v1/admin/retention`, `/api/v1/admin/programs`, `/api/v1/admin/calls`, `/api/admin/ingest-call`
- Public paths must be listed in `middleware.ts` `publicPaths` array (both locale variants and API routes)

### Database

- Schema in `app/src/lib/db/schema.ts` — PostgreSQL enums use Romanian values (e.g., `'ciorna'`, `'in_lucru'`, `'deschis'`)
- All IDs are UUID with `defaultRandom()`
- Soft deletes via `deletedAt` timestamp where applicable
- User tiers: `free`, `pro`, `enterprise` (affects AI rate limits)
- Drizzle migrations are in `app/drizzle/` — only files listed in `meta/_journal.json` run via `db:migrate`

### i18n

- Locales: `ro` (default), `en`
- Messages in `app/src/messages/ro.json` and `en.json`
- Server components use `useTranslations()` from next-intl
- All user-facing error messages must be bilingual (messageRo + messageEn in FondEUError)

### AI Providers

Multi-provider setup using direct SDK calls — no external gateway. Configuration in `app/src/lib/ai/config.ts`. Tier-based rate limits per feature (proposals: 10/day, docs: 20/day, grants: 50/day).

- **One-shot generation** (`lib/ai/client.ts`): routes through `lib/ai/providers/router.ts` which calls OpenAI/Anthropic/Google/Perplexity SDKs directly. Model selection via `lib/ai/model-routing.ts`. `aiGenerate`/`aiGenerateObject`/`aiEmbed` propagate original provider errors with status codes preserved — they wrap in `CircuitBreaker.execute` only (no outer `withRetry`, no `Errors.serviceUnavailable` masking) and log `{provider, model, tier}` on failure before rethrow.
- **Retry contract** (`lib/ai/providers/retry.ts`): single-attempt-with-fallback. Timeout-bounded primary call → on retryable error or internal timeout, fallback with a fresh `AbortController`. The `fn` parameter receives a signal: `(signal: AbortSignal) => Promise<GenerateResult>`. Adapters thread the signal to their SDK call's options (`signal ? { signal } : undefined`). Classifier distinguishes internal-timeout aborts (retryable, fallback fires) from external `AbortError` (caller cancelled, rethrow). `RETRYABLE_HTTP_STATUS = {408, 429, 500, 502, 503, 504}`, `RETRYABLE_NET_CODES = {ECONNRESET, ECONNREFUSED, ETIMEDOUT, EAI_AGAIN}`. A `raceAgainstAbort` helper guards against SDK clients that ignore `signal`.
- **Managed Agents** (`lib/ai/agent/managed/runtime.ts`): calls Anthropic SDK directly for streaming tool-use loops.
- **Discovery** (`lib/discovery/pipeline.ts`): uses the in-app `lib/ai/gateway.ts` adapter which instantiates provider SDKs — not an HTTP hop to an external service.
- **Embeddings**: always OpenAI `text-embedding-3-small` via direct SDK.
- **Prompt caching (router-level)**: `GenerateRequest.cache?: CacheOptions` and `GenerateResult.cacheUsage?: CacheUsage` are the provider-neutral handles. The Anthropic adapter branches: `cache.enabled=true` uses native `@anthropic-ai/sdk` via `providers/anthropic-native.ts`; `cache.enabled=false` (or omitted) stays on the OpenAI-compat shim. OpenAI gets `prompt_cache_key` when enabled. Google/Perplexity accept the option but only report `supported: false` and throw `UnsupportedOperationError` if `messages[]` contains `tool_calls`. See `docs/superpowers/specs/2026-04-21-v3-rag-prompt-caching-design.md` for the full contract. Global kill-switch: `prompt_cache_enabled` feature flag (seeded `false`). The router only reads the flag when `req.cache?.enabled === true` — PR 1 introduces zero DB traffic for non-opted-in callers.

### External Integrations

EU data: EurLex, CORDIS, Eurostat, EC Portal. Romanian: ONRC (company registry), ANAF (tax), MySMIS (project management system with XML export). All clients in `app/src/lib/integrations/`. Use `CircuitBreaker` from `@/lib/errors` for external API calls.

### Testing

- **Unit/Integration (Vitest)**: Node environment, globals enabled. Tests in `app/tests/`, integration tests in `app/tests/integration/`. Use `vi.mock()` for external dependencies (DB, auth, Redis). Mock IDs must be valid UUIDs (e.g., `'11111111-1111-4111-8111-111111111111'`). `logAudit` is typically mocked as `vi.fn()` in route tests.
- **E2E (Playwright)**: Config in `app/playwright.config.ts`. Three projects: setup (auth), chromium (authenticated), chromium-no-auth. Auth state stored in `app/e2e/.auth/user.json`. Traces and screenshots captured on failure.

### CI/CD

- GitHub Actions: quality → security-gates → build-and-test
- RLS tests only run when `vars.HAS_RLS_DATABASE == 'true'` — use `vars` (repository variables), never `secrets`, for job-level `if` conditions
- Production deploys to GCP Cloud Run via `deploy-production.yml` (manual trigger with approval gate)

### Scripts (Offline Tooling)

Canonical pipeline for document processing (all in `app/scripts/`):

1. `classify-documents.ts` — AI-classifies raw PDFs/docs into programs and document types
2. `create-reviewer-sheet.ts` — generates a text-based manual reviewer sheet for `UNKNOWN` classifications
3. `seed-programs.ts` — seeds the currently curated `funding_programs` set from classification data; expand it after manual review when new programs are confirmed
4. `bulk-ingest-rag-knowledge.ts` — chunks, embeds (OpenAI), and upserts to Qdrant. Requires `QDRANT_URL`, `QDRANT_API_KEY`, `OPENAI_API_KEY`
5. `direct-ingest-guides.ts` — **emergency-only**, direct DB writes bypassing API/auth. Requires `--dry-run` or `--confirm` flag, writes audit artifact
6. `generate-knowledge-vault.ts` — generates Obsidian notes and NotebookLM upload guides. Workstation-local, not product code. `VAULT_ROOT` env var overrides output path

Classification output lives in `app/scripts/classification-output/` (gitignored).

### Knowledge Stack

This project is part of a cross-project knowledge system:

- **Obsidian vault**: `EUFundsVault` — 620+ notes organized by program (PNRR, PEO, POTJ, etc.) with YAML frontmatter and Dataview queries
- **Custom commands**: `/research`, `/review-drafts`, `/daily`, `/adr` — work across vault + NotebookLM
- **NotebookLM notebooks**: 12 program-specific notebooks (FondEU-Architecture, FondEU-PEO, FondEU-PNRR, FondEU-POTJ, FondEU-POAT, FondEU-POCIDIF, FondEU-PDD, FondEU-PS, FondEU-POIM, FondEU-PR-NE, FondEU-POCU, FondEU-PoIDS). Registered via `mcp__notebooklm__add_notebook`, queryable via `/research`

### Adding new code

- **New drizzle migration**: hand-author SQL in `app/drizzle/NNNN_name.sql` (next free number), append matching entry to `meta/_journal.json` with `idx: N`, `tag: "NNNN_name"`, `when` greater than the previous entry. `npm run db:generate` is broken — see Gotchas. Mirror any RLS policies into `lib/db/rls.sql` for human readability, but the migrator only executes files under `drizzle/`, so the RLS SQL must live IN the migration to actually apply.
- **New feature flag**: seed via a new migration (see `0030_preselect_feature_flag.sql` for the canonical pattern: `INSERT ... ON CONFLICT (key) DO NOTHING`). Rollout/kill-switch flags must be read with `bypassCache: true` so an emergency disable isn't delayed by the 60s LRU cache.
- **New `AuditAction`**: add the string to the union in `lib/legal/audit.ts`, AND update `inferLegalBasis` if the prefix doesn't already resolve to a correct GDPR basis. The `session.*` → `contract` branch (for example) was added retroactively; new prefixes need the same consideration.
- **New V3 service mutation**: add a rule in `lib/ai/agent/policy/matrix.ts` and call `assertPolicy(...)` inside the service. Route handlers should discriminate errors via `instanceof ConcurrencyError` / `instanceof ValidationError` (and check `.policyCode`) rather than duck-typing on `.code` strings. Bypassing the service layer breaks the audit chain.
- **New public API route**: auth before rate-limit so `keySuffix: user.id` can tie the bucket to the user (not their IP). Feature-flag reads inside the handler should pass `bypassCache: true` for any flag that gates the route itself. User-facing errors use `{ error: { code, messageRo, messageEn } }`.

### Gotchas — surprising invariants

- `app/src/lib/db/rls.sql` is a **design reference, not an execution artifact** — the migrator only runs files under `app/drizzle/`. RLS policies for new tables must live in the drizzle migration file itself.
- `rls.sql` variable must match `withUserRLS()`: both use `app.current_user_id`.
- `requirePlatformAdmin()` always hits DB — never trust session alone for admin checks.
- `logAudit()` only logs when a DB mutation actually occurs (no-op guard for consent).
- `grantedAt` should NOT be set on withdraw-from-scratch consent records.
- `withAIAuth()` caches user tiers in-memory (LRU, 5-min TTL, max 10k users) — stale tier after upgrade for up to 5 min.
- Vector store `MemoryVectorStore` treats filter as key-value equality; `QdrantVectorStore` passes filter raw to Qdrant — not interchangeable for filtered searches.
- Storage paths validated against directory traversal via `path.resolve()` check.
- **Provider pricing tables are keyed on bare aliases** (e.g. `claude-sonnet-4-6`) but stream events may echo dated identifiers (`claude-sonnet-4-6-YYYYMMDD`). Always normalize before lookup — see `normalizeAnthropicModel` in `app/src/lib/ai/cost/anthropic-pricing.ts`. Exact-string lookup writes $0 cost telemetry for any dated id.
- **CallId-shape changes in `evidence.ts` need matching probes in `preselect/route.ts findMatchedCall`.** When `searchCalls` adds a new field to its callId fallback chain (`metadata.callId || metadata.callCode || metadata.sourceId || r.id`), the existence-check probes must be extended in lockstep — otherwise confirm-mode flakes `INVALID_CALL_ID`.
- **Route-level `stateVersion` guard fires on V3 path only.** The managed dispatch path skips the route's early stateVersion check so stale managed requests reach the runtime and get the bilingual concurrency envelope from the service layer. If you add a third runtime, decide explicitly whether route or runtime owns the precondition — otherwise concurrency surfaces will silently shift.

### Gotchas — production-only

- Qdrant must have `QDRANT_API_KEY` set in production — unauthenticated Qdrant is a read/write security risk.
- `instrumentationHook: true` in next.config.mjs enables Sentry — only active when `SENTRY_DSN` env var is set.
- `direct-ingest-guides.ts` is emergency-only — it bypasses API auth, audit logging, and review. Never use as a normal ingestion path.
- Kill-switch / rollout-control feature flags must pass `bypassCache: true` — a cached read can delay an emergency disable by up to 60s on warm instances.
- **Cloud Build deploy: `--set-env-vars` and `--set-secrets` are full-replace; `--update-secrets` is additive.** With `--update-secrets` (the form `cloudbuild.production.yaml` uses), keys not in the flag are left as-is on redeploy — but a key that was never wired in the first place will never be auto-added. Pre-flight any deploy by greping `app/src/lib/ai/providers/*.ts` for required env vars and matching every routed provider (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GOOGLE_AI_API_KEY`, …) against the deploy command. Missing-on-first-deploy is the failure mode — silent until a request hits the unrouted provider.

### Gotchas — dev-environment mechanics

- This repo uses git worktrees heavily. `.worktrees/` is gitignored; sibling external worktrees (`~/Dev/EU-Funds-*`) are also common. Check `git worktree list` before assuming master state — the primary checkout may not be up to date.
- `npm run db:generate` is broken — `app/drizzle/meta/` has only 9 of 31 snapshots (most indexes above `0006` are missing), so drizzle-kit aborts before emitting new SQL. Hand-author migrations until snapshots are rebuilt. See `0030_preselect_feature_flag.sql` for the canonical pattern.
- ESLint `ignoreDuringBuilds: true` in `next.config.mjs` — pre-existing issues, fix incrementally.
- `seed-admin.ts` requires `ADMIN_PASSWORD` in the environment — no source-code fallback. `PLAYWRIGHT_ADMIN_PASSWORD` must mirror it for any job that runs e2e login.
- Codex inline reviews use the `[bot]`-suffixed login. The `chatgpt-codex-connector` bot reviews every PR via the ChatGPT Codex integration. When fetching review comments via REST API (`pulls/:n/comments`), the author login is `chatgpt-codex-connector[bot]` — with the suffix; `gh pr view --json reviews` (GraphQL) strips it to `chatgpt-codex-connector`. Filtering on the wrong variant silently returns zero and makes it look like the bot found nothing.
- GitHub Actions billing block looks like a CI failure. If `quality` + `Scan for secrets` both fail with "The job was not started because recent account payments have failed" in the annotations — and no steps ran, no runner assigned — check billing at github.com/settings/billing before investigating code. Downstream CI jobs get SKIPPED via `needs:` dependency, which looks like a cascading failure but isn't.

## CI gate policy

New required CI checks must include a commit of record demonstrating them passing on master before being marked required in branch protection. A red required check is worse than no check — it normalizes override culture and stops protecting anything. This rule is the recurrence prevention for the April 2026 e2e-gate rollback.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills live in `~/.claude/skills/gstack/`. List the current set with:

```bash
find ~/.claude/skills/gstack -maxdepth 2 -name SKILL.md -printf '%h\n' | xargs -n1 basename | sort
```

If gstack skills aren't working, run `cd .claude/skills/gstack && ./setup` to build the binary and register skills.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
