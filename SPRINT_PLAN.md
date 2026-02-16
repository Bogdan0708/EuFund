# EU-Funds Sprint Plan — Post Triple Audit
## Generated: 2026-02-16

Based on findings from Codex 5.3 (Security), Claude Opus 4.6 (Backend), and Gemini 3 Pro (Frontend).

---

## Sprint 7 — Critical Security Fixes 🔴
**Priority:** IMMEDIATE | **Estimated effort:** 1-2 days
**Agent:** Codex (build) → Gemini (review)

| # | Finding | Source | File | Fix |
|---|---------|--------|------|-----|
| 1 | Path traversal in file upload | Codex+Claude | `documents/upload/route.ts:64` | Sanitize filename: `path.basename(file.name).replace(/[^a-zA-Z0-9.-]/g, '_')` |
| 2 | 10+ AI routes missing auth | Codex | `src/app/api/ai/*.ts` | Add `withAIAuth` wrapper to all unprotected AI endpoints |
| 3 | 6 integration routes missing auth | Codex | `api/integrations/*` | Add `requireAuth()` to funding-calls, eurlex, onrc, qes routes |
| 4 | Redis fail-open bypasses rate limits | Claude | `redis/client.ts:41-43` | Return `allowed: false` when Redis is down |
| 5 | Remove test-ai endpoint | Codex | `api/test-ai/route.ts` | Delete or gate behind `NODE_ENV === 'development'` |
| 6 | File type magic byte validation | Claude | `documents/upload/route.ts:48` | Validate PDF/DOCX magic bytes, don't trust client MIME |

---

## Sprint 8 — Backend Logic & Data Integrity 🟡
**Priority:** HIGH | **Estimated effort:** 2-3 days
**Agent:** Claude (build) → Gemini (review)

| # | Finding | Source | File | Fix |
|---|---------|--------|------|-----|
| 1 | Compliance score stored as string | Claude | `db/schema.ts:196` | Remove `.toString()`, store as numeric |
| 2 | Division by zero in cofinancing rate | Claude | `rules/eligibility.ts:185` | Guard: `if (!totalBudget) return not_applicable` |
| 3 | Silent audit log failures | Claude | `legal/audit.ts:68-93` | Add dead letter queue + alert on failure |
| 4 | No DB transactions for multi-step ops | Claude | API routes | Wrap create org+member, upload+insert in transactions |
| 5 | File upload orphan on DB failure | Claude | `documents/upload/route.ts:70` | Insert DB first, then write file; cleanup on catch |
| 6 | No timeout on AI calls | Claude | `ai/client.ts:20-42` | Add `AbortSignal.timeout(30000)` |
| 7 | Hardcoded DB creds in drizzle.config | Codex | `drizzle.config.ts:8` | Remove fallback, require DATABASE_URL |
| 8 | Replace all console.error (35 files) | Codex+Claude | Multiple | Swap to Pino structured logger |

---

## Sprint 9 — Frontend Quality & UX 🟠
**Priority:** MEDIUM | **Estimated effort:** 2-3 days
**Agent:** Gemini (build via research prompts) → Claude (review)

| # | Finding | Source | File | Fix |
|---|---------|--------|------|-----|
| 1 | XSS via dangerouslySetInnerHTML | Gemini | `advanced-search.tsx:110` | Use DOMPurify or custom parser |
| 2 | Client-side fetching anti-pattern | Gemini | `proiecte/[id]/page.tsx` | Convert to Server Component with async data fetch |
| 3 | Add loading.tsx files | Gemini | Dashboard routes | Create loading skeletons for data-fetching routes |
| 4 | Add error.tsx boundaries | Gemini | Dashboard routes | Error boundaries with retry button |
| 5 | Fix login redirect | Gemini | `autentificare/page.tsx:28` | `router.push()` instead of `window.location.href` |
| 6 | Replace `<a>` with `<Link>` | Gemini | Auth pages | Use next/link for internal navigation |
| 7 | Accessibility: clickable divs | Gemini | Consortium components | Add `role="button"`, `tabIndex`, keyboard handlers |

---

## Sprint 10 — Performance & Observability 🟢
**Priority:** MEDIUM-LOW | **Estimated effort:** 2-3 days
**Agent:** Codex (build) → Claude (review)

| # | Finding | Source | Fix |
|---|---------|--------|-----|
| 1 | N+1 query in projects list | Claude | Add org join to projects query |
| 2 | Full table scan on search | Claude | Add PostgreSQL full-text search index |
| 3 | Unbounded integration cache | Claude | Replace Map with LRU cache |
| 4 | No request correlation IDs | Claude | Add requestId middleware |
| 5 | No API call timeouts logged | Claude | Add duration logging to all external calls |
| 6 | Remove `unsafe-inline` from CSP styles | Gemini | Nonce-based style loading |
| 7 | Cache key versioning | Claude | Add prompt version to AI cache keys |

---

## Sprint 11 — Code Quality & Standards 🔵
**Priority:** LOW | **Estimated effort:** Ongoing
**Agent:** All three in rotation

| # | Finding | Source | Fix |
|---|---------|--------|-----|
| 1 | Eliminate 37 `any` types | Claude | Replace with proper generics/Zod |
| 2 | Standardize response envelope | Claude | Consistent `{ success, data, error }` format |
| 3 | Fix hardcoded i18n strings | Gemini | Move to message files |
| 4 | Consistent UI theming | Gemini | Replace hardcoded colors with theme vars |
| 5 | Consistent form handling | Gemini | Standardize on react-hook-form + zod |
| 6 | Enable ESLint in builds | Gemini | Fix errors, remove `ignoreDuringBuilds` |
| 7 | Add API documentation | Claude | OpenAPI/Swagger spec |
| 8 | Remove unnecessary `'use client'` | Gemini | Audit all page components |

---

## Manual Tasks (Bogdan)

| Task | Status |
|------|--------|
| `cd ~/Dev/EU-Funds/app && npm audit fix` | ⏳ Needs network |
| Rotate OpenAI key on dashboard | ⏳ sk-proj-JF8DTY35... compromised |
| Set `CLOUD_SQL_INSTANCE` GitHub secret | ⏳ For deploy workflow |
| Close Claude on Windows + update | ⏳ 2.1.37 → 2.1.42 |
| `sudo npm rm -g @openai/codex` (WSL) | ⏳ Remove system duplicate |
| Check AbacusAI billing/credits | ⏳ CLI hanging due to quota |

---

## Workflow Per Sprint

```
1. Research (if needed)  → Gemini CLI + Perplexity
2. Build                 → Codex CLI (security/infra) or Claude -p (backend/logic)
3. Review                → Gemini CLI (always) + cross-check with Claude
4. Test                  → npm run build && npm run test
5. Commit                → One commit per sprint
```

**Rule:** No code changes without review. No deploy without local test passing.

---

## Score Targets

| Sprint | Current | Target | Metric |
|--------|---------|--------|--------|
| 7 (Security) | ~5/10 | 8/10 | Auth coverage, input validation |
| 8 (Backend) | ~6/10 | 8/10 | Data integrity, error handling |
| 9 (Frontend) | ~6/10 | 8/10 | UX patterns, accessibility |
| 10 (Performance) | ~5/10 | 7/10 | Query optimization, caching |
| 11 (Quality) | ~6/10 | 8/10 | Type safety, standards |
