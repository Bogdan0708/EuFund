# FondEU — Production Plan

**Status: PRE-PRODUCTION (Needs Critical Fixes)**
**Score: 7.2/10**
**Estimated effort: 2-3 weeks**
**Current: Next.js 14, Drizzle ORM, PostgreSQL, deployed on GCP Cloud Run**

---

## Current State

- 390/396 tests passing (98.5%)
- TypeScript clean, 6 ESLint errors (unused vars)
- Strong security: CSRF, CSP nonces, RLS, audit hash chain, GDPR consent
- AI integration: RAG pipeline, multi-agent orchestrator, prompt injection defense
- E2E tests exist but broken (Playwright config issue)
- 23 dependency vulnerabilities (9 moderate, 14 high)

---

## Phase 1: Blockers (1 week)

### 1.1 Fix 6 Failing Tests
- [ ] **Logger mock (2 failures)**: Create proper pino mock in test setup for `timeline-assignee-validation.test.ts`
- [ ] **Middleware public paths (1 failure)**: Update test to not rely on reading source as string
- [ ] **Project route 409 (1 failure)**: Add try-catch, return 409 instead of 500 when orgId missing
- [ ] **AI gateway contract (1 failure)**: Verify fail-closed behavior when gateway config absent
- [ ] **Trial notifications auth (1 failure)**: Fix admin auth middleware to return 403 not 500

### 1.2 Fix E2E Tests
- [ ] Fix Playwright `test.describe()` configuration issue
- [ ] Verify all 13 e2e specs can run
- [ ] Add E2E step to CI pipeline

### 1.3 Dependency Vulnerabilities
- [ ] Run `npm audit fix` (resolves picomatch, rollup, serialize-javascript, undici, flatted)
- [ ] Evaluate nodemailer upgrade to 8.0.4 (breaks next-auth beta constraint)
- [ ] Document xlsx vulnerability as accepted risk (no fix available, low exposure — file parsing only)
- [ ] Test after patching

### 1.4 Code Cleanup
- [ ] Fix 6 ESLint unused variable errors
- [ ] Remove `ignoreDuringBuilds: true` from next.config.mjs ESLint config
- [ ] Fix audit DLQ path: use absolute path (`/var/log/audit-dlq.log`) not relative

---

## Phase 2: Security & Error Handling (1 week)

### 2.1 Error Boundaries
- [ ] Add `src/app/[locale]/error.tsx` (global error boundary)
- [ ] Add `src/app/[locale]/not-found.tsx` (404 page)
- [ ] Add error boundaries for dashboard route group

### 2.2 Security Hardening
- [ ] Review `allowDangerousEmailAccountLinking: true` on OAuth providers — document risk or disable
- [ ] Verify .env.local is in .gitignore (audit found it committed)
- [ ] Ensure Qdrant API key is required in production (unauthenticated Qdrant = read/write risk)
- [ ] Add SRI (Subresource Integrity) for external scripts
- [ ] Restrict CSP `connect-src` to specific API domains

### 2.3 Observability
- [ ] Integrate CSP violation monitoring with Sentry (TODO in csp-report/route.ts)
- [ ] Add OpenTelemetry for distributed tracing
- [ ] Verify Sentry error capture is active in production (SENTRY_DSN must be set)

---

## Phase 3: Quality & Completeness (1 week)

### 3.1 Testing
- [ ] Add component integration tests for critical UI (project wizard, grant matching)
- [ ] Add accessibility tests (axe-playwright) for main user flows
- [ ] Add load test for AI endpoints (rate limit verification)
- [ ] Verify RLS enforcement tests run in CI (set `HAS_RLS_DATABASE=true`)

### 3.2 AI Integration Validation
- [ ] Test AI Gateway connection end-to-end (proposal generation, grant matching, eligibility check)
- [ ] Verify prompt injection defense with adversarial test cases
- [ ] Validate RAG pipeline retrieval quality (sample queries, relevance scoring)
- [ ] Test circuit breaker behavior for external integrations (EurLex, CORDIS, ONRC)

### 3.3 Documentation
- [ ] Document GCP Cloud Run deployment process (cloudbuild.production.yaml)
- [ ] Create production runbook (incident response, rollback, monitoring)
- [ ] Document RLS test environment setup
- [ ] Update CLAUDE.md with any architectural changes

---

## Phase 4: Pre-Launch (ongoing)

### 4.1 Performance
- [ ] Profile database queries, add indexes for slow paths
- [ ] Optimize AI token usage (prompt compression, response caching)
- [ ] Verify image optimization (WebP + AVIF) working correctly

### 4.2 i18n Completeness
- [ ] Audit ro.json and en.json for missing/stale keys
- [ ] Verify all error messages are bilingual (FondEUError messageRo + messageEn)

### 4.3 Feature Flags
- [ ] Review feature flag configuration for production
- [ ] Ensure fail-closed behavior (unknown flags = false)
- [ ] Document rollout strategy for new features

---

## Paperclip Agent Assignments

| Agent | Role | Ticket Types |
|-------|------|-------------|
| **Claude Code** | engineer | Test fixes, error boundaries, security patches, RLS validation, AI integration testing |
| **Codex** | engineer | CI/CD improvements, E2E test fixes, dependency updates, load tests, OpenTelemetry setup |
| **Gemini** | engineer | Documentation, accessibility audit, i18n review, RAG quality evaluation, runbook creation |
