# EuFund Technical Audit Report

**Date:** 2026-02-20  
**Branch:** master  
**Auditor:** Automated deep audit  
**Project Phase:** Debugging/stabilization with business partner testing

---

## Executive Summary

EuFund is a well-structured Next.js + TypeScript EU funding platform with solid foundations: proper auth, rate limiting, GDPR compliance, AI orchestration with multi-provider fallback, and a reasonable CI/CD pipeline. However, several **P0/P1 issues** need attention before production confidence is high — notably CSRF exemptions on all AI/API endpoints, dual `next.config` files causing confusion, no input sanitization on AI prompts, and very thin test coverage (~1,870 lines for a 12,000+ line AI layer alone).

**Risk rating: Medium-High** — Auth and rate limiting are solid, but the CSRF gaps and AI prompt injection surface are concerning for a platform handling EU funding data.

---

## 1. Code Quality

### Architecture — **Good (B+)**
- Clean separation: `lib/ai/`, `lib/db/`, `lib/auth/`, `lib/integrations/`, `lib/middleware/`
- AI orchestrator pattern with provider registry, router, cache — well designed
- Drizzle ORM with proper schema, enums, indexes
- Romanian localization baked in (not bolted on) — good for the target market

### Issues

| Priority | Issue | Location |
|----------|-------|----------|
| **P1** | **Dual `next.config` files** — `next.config.mjs` (active, 1KB) and `next.config.production.js` (unused, has optimizations like `optimizeCss`, `removeConsole`, image config). Production optimizations are NOT applied. | `app/next.config.mjs`, `app/next.config.production.js` |
| **P1** | **ESLint `ignoreDuringBuilds: true`** — all lint errors suppressed during build. Tech debt accumulates silently. | `app/next.config.mjs:8` |
| **P1** | **AI layer bloat** — 12,343 lines across 34 files in `lib/ai/`. Many files (budget-intelligence 592L, timeline-optimizer 744L, compliance-engine 767L) are large monoliths. Multiple overlapping generators: `proposal-generator.ts`, `proposal-generator-v2.ts`, `enhanced-proposal-generator.ts`. | `app/src/lib/ai/` |
| **P2** | **Inconsistent indentation** in `analyze-document/route.ts` — handler body not indented inside `withAIAuth` callback. | `app/src/app/api/ai/analyze-document/route.ts:16-80` |
| **P2** | **`(session.user as any).id`** in auth callbacks — type assertion instead of proper type extension. | `app/src/lib/auth/index.ts:62` |
| **P2** | **Hardcoded `userTier: 'enterprise'`** in legacy AI client fallback path. | `app/src/lib/ai/client.ts:60,80` |

---

## 2. Security

### Strengths
- ✅ JWT sessions with 24h expiry, secure cookies in production
- ✅ bcrypt password hashing (cost 12)
- ✅ CSP with nonces (strict-dynamic)
- ✅ HSTS, X-Frame-Options DENY, Permissions-Policy
- ✅ Rate limiting on registration (5 req/15min)
- ✅ AI endpoint rate limiting by tier (Redis-backed, fail-closed)
- ✅ PII detection and redaction before AI analysis
- ✅ Audit logging for auth and AI operations

### Issues

| Priority | Issue | Location |
|----------|-------|----------|
| **P0** | **CSRF exemption on ALL AI and API v1 endpoints** — `/api/v1/`, `/api/ai/`, `/api/integrations/` are all CSRF-exempt. Any authenticated user's browser can be tricked into making state-changing POST requests to these endpoints via CSRF attacks. The `withAIAuth` middleware does auth + rate limiting but **no CSRF check**. | `app/src/middleware.ts:129-136` |
| **P0** | **No AI prompt injection protection** — User input (`projectIdea`, `message`, `content`) is passed directly into AI prompts without sanitization or boundary markers. An attacker could inject system-level instructions via the chat endpoint (`message` field, max 4000 chars) or proposal generator. | `app/src/app/api/ai/chat/route.ts:42-47`, `app/src/lib/ai/document-analyzer.ts:130-145` |
| **P1** | **SQL injection risk via `ilike` with unsanitized search** — `search` param passed directly to `ilike(projects.title, \`%${search}%\`)`. While Drizzle parameterizes this, the `%` wildcards in the search string itself are not escaped, enabling wildcard injection for DoS. | `app/src/app/api/v1/projects/route.ts:57` |
| **P1** | **Health endpoint exposes internal details** — Memory usage, uptime, service states, version number exposed without auth. Useful for attackers fingerprinting the deployment. | `app/src/app/api/health/route.ts` |
| **P1** | **CSRF token in httpOnly cookie** — The CSRF cookie is set `httpOnly: true`, but the client needs to read it to send in the header. Currently exposed via `X-CSRF-Token` response header, but this only works on the initial set. Client-side JS needs a way to consistently read the token. | `app/src/middleware.ts:154-161` |
| **P2** | **`trustHost: true`** in NextAuth config — disables host header validation. Fine behind a reverse proxy, but should be documented. | `app/src/lib/auth/index.ts:69` |
| **P2** | **`.env.example` contains real-looking patterns** — `DATABASE_URL` has a real-looking connection string with credentials. | `.env.example` |

---

## 3. Performance

### Strengths
- ✅ Redis-based AI response caching with TTL per task type
- ✅ LRU cache for user tiers (10K entries, 5min TTL)
- ✅ Circuit breakers on all AI providers (5 failures, 60s timeout)
- ✅ `output: 'standalone'` in Next.js config

### Issues

| Priority | Issue | Location |
|----------|-------|----------|
| **P1** | **Production optimizations not applied** — `next.config.production.js` has `optimizeCss`, `optimizePackageImports`, `removeConsole`, image optimization — none active because `next.config.mjs` is the actual config file used. | `app/next.config.mjs` vs `app/next.config.production.js` |
| **P1** | **No streaming for AI responses** — All AI endpoints wait for complete response before sending to client. For proposal generation (4096 tokens), this means 10-30s of blank waiting. Should use Server-Sent Events or streaming. | `app/src/app/api/ai/generate-proposal/route.ts` |
| **P2** | **`redis.keys('ai_cache:*')` in cache stats** — `KEYS` command blocks Redis and is O(N). Should use `SCAN` instead. | `app/src/lib/ai/cache.ts:89,107` |
| **P2** | **No DB connection pooling tuning for production** — `max: 10` connections hardcoded. Cloud Run instances may need different pool sizes. | `app/src/lib/db/index.ts:18` |
| **P2** | **Batch embedding processes sequentially in groups of 20** — Could parallelize batches. | `app/src/lib/ai/client.ts:243` |
| **P2** | **Document analysis truncates at 15K chars** — Large PDFs lose significant content. Consider chunked analysis. | `app/src/lib/ai/document-analyzer.ts:120` |

---

## 4. Docker/Deployment

### Strengths
- ✅ Multi-stage Dockerfile with proper separation (deps → builder → runner)
- ✅ Non-root user (`nextjs:1001`)
- ✅ Cloud Run deployment with secrets management
- ✅ Pre-deployment DB backup in deploy workflow
- ✅ Health check with retry logic

### Issues

| Priority | Issue | Location |
|----------|-------|----------|
| **P1** | **Dockerfile.prod doesn't copy `standalone` output** — Config has `output: 'standalone'` but Dockerfile copies `.next` directory directly. Should copy `.next/standalone` for minimal image size. | `infrastructure/Dockerfile.prod:17-21` |
| **P1** | **No `.dockerignore` tuning** — Root `.dockerignore` exists (141 bytes) but likely doesn't exclude all unnecessary files (docs, compliance, monitoring, markdown files). Build context may be bloated. | `.dockerignore` |
| **P2** | **`cloudbuild.yaml` has no substitutions or build args** — Secrets like `DATABASE_URL` baked into build layer. The dummy `DATABASE_URL` in Dockerfile is fine, but there's no mechanism for passing runtime env vars. | `cloudbuild.yaml` |
| **P2** | **Docker Compose mounts `./app/src` as volume** — Good for dev, but the `app` service image tag `eu-funds:latest` suggests it might accidentally be used for non-dev purposes. | `docker-compose.yml:28` |
| **P2** | **No Docker healthcheck in Dockerfile.prod** — Cloud Run has its own, but container orchestrators (K8s manifests exist) need it. | `infrastructure/Dockerfile.prod` |

---

## 5. Testing

### Current State — **Poor (D)**
- **1,869 total lines** across 11 test files
- Only unit tests for utilities (PII detection, error handling, rules, Romanian text processing)
- Integration tests exist for security but are likely not runnable (need DB/Redis)

### Issues

| Priority | Issue | Location |
|----------|-------|----------|
| **P0** | **Zero API route tests** — No tests for any of the 20+ API routes. The core business logic (proposal generation, document analysis, grant matching) has no test coverage. | `app/tests/` |
| **P0** | **Zero E2E tests** — No Playwright/Cypress. For a platform in user testing phase, critical flows (register → create project → generate proposal) are untested. | — |
| **P1** | **AI integration tests mock nothing** — `ai-components.test.ts` only tests `detectPII` and text processing utilities, not actual AI call paths. | `app/tests/ai-components.test.ts` |
| **P1** | **No test for auth flows** — Registration, login, password reset, email verification all untested. | — |
| **P2** | **No test config for CI environment** — Tests use `environment: 'node'` only. Component tests (`phase3-components.test.tsx`) likely need jsdom. | `app/vitest.config.ts` |

---

## 6. DX & UX

### Strengths
- ✅ Romanian-first UI with i18n support (next-intl)
- ✅ Structured error responses with bilingual messages
- ✅ Loading states (`loading.tsx`) and error boundaries (`error.tsx`)
- ✅ Good script setup in `package.json` (db commands, analyze, health check)

### Issues

| Priority | Issue | Location |
|----------|-------|----------|
| **P1** | **No error recovery guidance for users** — API errors return technical codes like `RATE_LIMIT_EXCEEDED` and `CSRF_REQUIRED` without user-friendly guidance on what to do. | Various API routes |
| **P1** | **AI requests have no progress indication** — No streaming, no websocket updates. Users stare at a spinner for 10-30 seconds during proposal generation. | Frontend AI components |
| **P2** | **Login redirect hardcoded to `/ro/autentificare`** — English users get redirected to Romanian login page. | `app/src/lib/auth/index.ts:54-55`, `app/src/middleware.ts:109` |
| **P2** | **`next.config.mjs` has `ignoreDuringBuilds: true`** — Contributors get no lint feedback during build. | `app/next.config.mjs:8` |
| **P2** | **No seed data documentation** — `db:seed` exists but no docs on what it seeds or how to get a working dev environment. | `app/package.json` |

---

## 7. Dependencies

### Analysis
- **Next.js 14.2.35** — Stable, good choice. Next 15 not needed yet.
- **Zod v4.3.6** — Note: Zod v4 is a major rewrite. `z.toJSONSchema` usage in `client.ts` depends on this.
- **next-auth 5.0.0-beta.25** — Beta version in production. Known instability.
- **`@types/bcryptjs`** and **`@types/dompurify`** in dependencies (not devDependencies).

### Issues

| Priority | Issue | Location |
|----------|-------|----------|
| **P1** | **next-auth v5 beta in production** — Beta software for auth is risky. Pin to a known-good beta or monitor for breaking changes closely. | `app/package.json` |
| **P1** | **`@types/*` packages in `dependencies`** instead of `devDependencies`** — `@types/bcryptjs` and `@types/dompurify` ship to production bundle unnecessarily. | `app/package.json` |
| **P2** | **Three AI SDKs installed** — `openai`, `@ai-sdk/openai`, and `ai` (Vercel AI SDK) plus `@anthropic-ai/sdk` and `@google/generative-ai`. The orchestrator abstracts these, but 5 AI packages is heavy. | `app/package.json` |
| **P2** | **No `npm audit` enforcement** — CI runs `npm audit` with `continue-on-error: true`. Vulnerabilities don't block merges. | `.github/workflows/ci.yml:42` |

---

## 8. CI/CD Readiness

### Strengths
- ✅ CI pipeline: lint → typecheck → test → build → Docker build → Trivy scan
- ✅ Production deploy with approval gate, DB backup, health check, rollback support
- ✅ Dependabot configured
- ✅ Gitleaks for secret scanning
- ✅ Workload Identity Federation (no service account key)

### Issues

| Priority | Issue | Location |
|----------|-------|----------|
| **P1** | **No staging deployment in CI** — `deploy-staging.yml` exists but isn't triggered by CI. No automatic preview deployments for PRs. | `.github/workflows/` |
| **P1** | **Cloud Build (`cloudbuild.yaml`) and GitHub Actions are both configured** — Two competing deployment systems. `cloudbuild.yaml` builds the image, GitHub Actions deploys to Cloud Run. Unclear which is the source of truth for image building. | `cloudbuild.yaml`, `.github/workflows/deploy-production.yml` |
| **P2** | **No database migration step in deployment** — `db:migrate` script exists but isn't called during deployment. Schema changes require manual intervention. | `.github/workflows/deploy-production.yml` |
| **P2** | **Docker build in CI doesn't push to registry** — CI builds the image and scans it, but doesn't push. The production deploy references images in Artifact Registry that must be built separately. | `.github/workflows/ci.yml:59` |

---

## 9. AI Integration

### Strengths
- ✅ Multi-provider orchestrator (OpenAI, Anthropic, Google, Romanian BERT, custom gateway)
- ✅ Intelligent routing based on task type and language
- ✅ Circuit breakers per provider with automatic fallback
- ✅ Caching with task-type-aware TTL
- ✅ PII redaction before sending to AI providers
- ✅ GDPR-aware config with SCC references and data retention policy
- ✅ Structured output with Zod schema validation
- ✅ Audit logging of all AI operations

### Issues

| Priority | Issue | Location |
|----------|-------|----------|
| **P0** | **No prompt injection protection** — User text is interpolated directly into prompts. The chat endpoint sends raw user messages. Document analyzer embeds file content directly. No delimiters, no input validation beyond length. An attacker could inject "Ignore previous instructions and..." | `app/src/app/api/ai/chat/route.ts:42-47`, `app/src/lib/ai/document-analyzer.ts:126-145`, `app/src/lib/ai/proposal-generator.ts` |
| **P1** | **No per-endpoint cost tracking** — Token usage is logged but not aggregated. No way to see which endpoints cost the most, or per-user cost. | `app/src/lib/ai/client.ts` |
| **P1** | **No max concurrent AI requests limit** — Rate limiting is per-hour, but a user could fire 10 simultaneous expensive requests. No semaphore or queue. | `app/src/lib/middleware/auth.ts` |
| **P1** | **Hardcoded `userTier: 'enterprise'` in legacy path** — The direct AI client fallback bypasses tier restrictions entirely. | `app/src/lib/ai/client.ts:60,80` |
| **P2** | **Token estimation for embeddings** — `Math.ceil(text.length / 4)` is a rough heuristic. Could under-count for Romanian text with diacritics. | `app/src/lib/ai/client.ts:107` |
| **P2** | **No AI response validation** — Beyond Zod schema parsing, no semantic validation that AI responses are sensible (e.g., budget amounts are positive, dates are valid). | Various AI modules |
| **P2** | **Cache key uses `JSON.stringify`** — Object key ordering isn't guaranteed. Same request with different key order produces different cache keys. | `app/src/lib/ai/cache.ts:144` |

---

## Priority Summary

### P0 — Fix Immediately (3 issues)
1. **CSRF exemption on all AI/v1/integration endpoints** — Add CSRF validation or switch to token-based auth for API routes
2. **AI prompt injection** — Add input sanitization, delimiter markers (`<<<USER_INPUT>>>...<<<END_USER_INPUT>>>`), and instruction hierarchy
3. **Zero API/E2E test coverage** — At minimum, add integration tests for auth flows and the top 3 AI endpoints

### P1 — Fix This Sprint (14 issues)
- Merge `next.config.production.js` optimizations into `next.config.mjs`
- Fix Dockerfile standalone output copy
- Add AI response streaming
- Pin or carefully manage next-auth beta
- Move `@types/*` to devDependencies
- Add staging auto-deploy
- Add concurrent AI request limiting
- Fix hardcoded enterprise tier in legacy client
- Add per-endpoint cost tracking
- Fix health endpoint info exposure
- Resolve Cloud Build vs GitHub Actions confusion
- Fix ESLint ignore
- Fix SQL wildcard injection in search
- Fix login redirect for English users

### P2 — Fix Next Sprint (15 issues)
- Replace `redis.keys()` with `SCAN`
- Add Docker healthcheck
- Add DB migration to deploy pipeline
- Stabilize cache key generation
- Document seed data
- Various code quality cleanups

---

## Recommendations

1. **Immediate security hardening session** — CSRF + prompt injection fixes (1-2 days)
2. **Add Playwright E2E for critical path** — Register → login → create project → generate proposal (2-3 days)
3. **Merge Next.js configs** — Copy production optimizations into the active config (1 hour)
4. **Fix Dockerfile** — Use standalone output, add healthcheck (1 hour)
5. **Add AI streaming** — Server-Sent Events for proposal generation (1 day) — huge UX win
6. **Consolidate CI/CD** — Pick one image build system, add staging auto-deploy (half day)
