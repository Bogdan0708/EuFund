# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FondEU (PlatformaFinantare.eu) — AI-powered platform for Romanian organizations to prepare EU funding applications. Built with Next.js 14 App Router, TypeScript, Drizzle ORM + PostgreSQL (postgres.js driver), NextAuth v5 beta, next-intl (ro/en).

## Commands

All commands run from the `app/` directory:

```bash
# Development
npm run dev              # Start dev server (port 3000)
npm run build            # Production build
npm run lint             # ESLint (next lint)
npm run typecheck        # tsc --noEmit

# Tests (Vitest)
npm run test             # Run all tests once
npm run test:watch       # Watch mode
npx vitest run tests/integration/feature-flags.test.ts  # Single test file

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
│       ├── ai/             # AI endpoints (generate-proposal, match-grants, chat, check-eligibility)
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

**CSP nonce**: Middleware generates `crypto.randomUUID()`, passes via `x-nonce` request header. Server components read via `getNonce()` from `@/lib/security/nonce`.

**Audit logging**: `logAudit()` from `@/lib/legal/audit`. Tamper-evident SHA-256 hash chain — each entry links to the previous via `previousHash`/`entryHash`. DLQ fallback ensures audit failures never crash requests. Verify chain with `verifyAuditChainIntegrity()`.

**Feature flags**: `isFeatureEnabled(key, ctx)` from `@/lib/feature-flags`. DB-backed with 60s LRU cache (max 500 entries). Supports tier targeting, userId targeting, and deterministic percentage rollout (MD5 hash). Fail-closed: unknown flags return `false`.

**Redis rate limiting**: Fail-closed for AI endpoints (503 if Redis unavailable), preventing unmetered AI usage.

**Validation**: Zod for all request schemas, defined in `@/lib/validation/schemas.ts`. Key schemas: `extractedCallSchema`, `generateProposalSchema`, `checkEligibilitySchema`, `wizardMatchCallsSchema`. Types are inferred from schemas.

**Knowledge ingestion pipeline**: `lib/ai/knowledge/` — three-stage pipeline: `parser.ts` (PDF/Word → text) → `extractor.ts` (AI-powered structured extraction) → `ingestor.ts` (vector store/RAG ingestion). Triggered via `/api/admin/ingest-call` (multipart upload, 15MB max, PDF/DOCX/XLSX/TXT).

**Vector store / RAG**: `lib/vectors/store.ts` — abstraction over Qdrant (production) and in-memory (dev). Controlled by `VECTOR_PROVIDER` env var. Qdrant requires `QDRANT_URL` and `QDRANT_API_KEY`. Collection name defaults to `eu_legislation`. RAG pipeline in `lib/rag/pipeline.ts` — hybrid search (semantic + keyword boost), sentence-based chunking (1000 chars, 200 overlap), chunk validation against poisoning patterns, per-source token budgeting (500 tokens/source, 1600 total context).

**Crawler sources**: `lib/connectors/sources/config.ts` — currently 11 pre-configured web scraping targets for Romanian funding sources (3 national + 8 regional ADRs). Additional sources should be added only after manual review confirms they are worth operationalizing. Each source has CSS selectors, program detection keywords, and channel metadata.

**Password hashing**: bcryptjs with cost factor 12.

**Token TTLs**: Email verification = 24h, password reset = 1h.

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

Multi-provider setup: OpenAI (primary), Anthropic (alternative), Google (alternative), Perplexity. Configuration in `app/src/lib/ai/config.ts`. Tier-based rate limits per feature (proposals: 10/day, docs: 20/day, grants: 50/day).

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

### Gotchas

- `rls.sql` variable must match `withUserRLS()`: both use `app.current_user_id`
- `requirePlatformAdmin()` always hits DB — never trust session alone for admin checks
- `logAudit()` only logs when a DB mutation actually occurs (no-op guard for consent)
- `grantedAt` should NOT be set on withdraw-from-scratch consent records
- Storage paths validated against directory traversal via `path.resolve()` check
- ESLint `ignoreDuringBuilds: true` in `next.config.mjs` — pre-existing issues, fix incrementally
- `withAIAuth()` caches user tiers in-memory (LRU, 5-min TTL, max 10k users) — stale tier after upgrade for up to 5 min
- `instrumentationHook: true` in next.config.mjs enables Sentry — only active when `SENTRY_DSN` env var is set
- Qdrant must have `QDRANT_API_KEY` set in production — unauthenticated Qdrant is a read/write security risk
- `direct-ingest-guides.ts` is emergency-only — it bypasses API auth, audit logging, and review. Never use as a normal ingestion path
- Vector store `MemoryVectorStore` treats filter as key-value equality; `QdrantVectorStore` passes filter raw to Qdrant API — not interchangeable for filtered searches

## CI gate policy

New required CI checks must include a commit of record demonstrating them passing on master before being marked required in branch protection. A red required check is worse than no check — it normalizes override culture and stops protecting anything. This rule is the recurrence prevention for the April 2026 e2e-gate rollback.
