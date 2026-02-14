# EU Funding Platform - Technical Audit Report
**Date:** 2026-02-13
**Auditor:** Codex (GPT-5.2)

## Executive Summary

Investigated 4 reported issues. Found and fixed 2 critical API integration bugs. Identified 1 missing configuration and 1 architectural limitation.

---

## Issues Found & Fixed

### 🔴 P0-1: Funding Calls API — FIXED ✅
**Error:** "Eroare la obținerea apelurilor de finanțare"
**Root Cause:** EC Funding & Tenders Portal Search API requires `POST` method, but code used `GET`.
**File:** `src/lib/integrations/ec-portal/client.ts`
**Fix:**
- Changed HTTP method from GET to POST
- Fixed metadata parsing (EC API returns arrays, not `{value}` objects)
- Fixed status code mapping (numeric IDs: 31094501=Open, 31094502=Forthcoming, 31094503=Closed)
- Added client-side status filtering (EC API doesn't support server-side status filters reliably)
**Status:** Working — returns live EU funding calls from EC Portal

### 🔴 P0-2: EUR-Lex Legislation Search — FIXED ✅
**Error:** No results for any search queries
**Root Cause:** Two SPARQL query issues:
1. `expression_uses_language` predicate no longer returns results in the CDM ontology endpoint
2. `CONTAINS(LCASE(?title), ...)` doesn't work with `xml:lang`-tagged RDF literals
**File:** `src/lib/integrations/eurlex/client.ts`
**Fix:**
- Replaced `expression_uses_language` with `FILTER(LANG(?title) = "...")` 
- Replaced `CONTAINS(LCASE())` with `REGEX(STR(), "...", "i")`
- Removed `work_date_document` join (was causing empty results)
- Removed `resource_legal_in-force` filter (compatibility)
**Status:** Working — returns Romanian and English EU legislation from EUR-Lex SPARQL

### 🟡 P0-3: AI Assistant — NOT FIXED (Missing API Key)
**Error:** AI assistant returns generic/error responses
**Root Cause:** No `OPENAI_API_KEY` configured in `.env.local`
**File:** `src/lib/ai/client.ts` uses `@ai-sdk/openai` requiring valid API key
**Impact:** All AI features non-functional:
- Proposal generator (`/api/ai/generate-proposal`)
- Grant matcher (`/api/ai/match-grants`)
- Compliance validator (`/api/ai/validate-compliance`)
- Document analyzer (`/api/ai/analyze-document`)
**Fix Required:** Add `OPENAI_API_KEY=sk-...` to `.env.local`
**Alternative:** Could be reconfigured to use LM Studio at `http://172.25.208.1:1234/v1` with OpenAI-compatible API

### 🟢 P1-1: NEXTAUTH_URL Mismatch — FIXED ✅
**Issue:** `NEXTAUTH_URL` was set to `localhost:3000` but app runs on port `3001`
**File:** `.env.local`
**Fix:** Updated to `http://localhost:3001`

---

## Database Status ✅
All seeded data intact:
- `funding_programs`: 5 records (Horizon Europe, LIFE+, Interreg VI, POCIDIF, PNRR)
- `calls_for_proposals`: 4 records (seeded Romanian-focused calls)
- `legislation_documents`: 4 records (EU regulation samples)
- `funding_calls` (live cache): 0 records (populated on-demand from EC Portal)
- PostgreSQL: Running in Docker (`eu-funds-postgres-1`)
- Redis: Running in Docker (`eu-funds-redis-1`)

## Infrastructure Status
- **Docker:** PostgreSQL 16 + Redis 7 running healthy
- **Cloudflare Tunnel:** Active at `superintendent-matt-preservation-skill.trycloudflare.com`
- **Next.js Dev Server:** Running on port 3001

## External API Integration Status

| Integration | Status | Notes |
|------------|--------|-------|
| EC F&T Portal | ✅ Working | POST method fix applied |
| EUR-Lex SPARQL | ✅ Working | LANG() filter fix applied |
| ANAF Tax API | ⚠️ Untested | Real API at webservicesp.anaf.ro |
| ONRC Registry | ⚠️ Untested | Web scraping approach, may be fragile |
| OpenAI (AI) | ❌ No API key | Required for all AI features |
| HuggingFace BERT | ❌ No token | Required for Romanian NLP |

## Architecture Notes
- Circuit breaker pattern on all external APIs (5 failures → 60s cooldown)
- In-memory caching (should be Redis in production)
- Rate limiting with exponential backoff
- GDPR-compliant audit logging
- Drizzle ORM with PostgreSQL

## Remaining Work
1. **Add OPENAI_API_KEY** to enable AI features
2. **Consider LM Studio integration** for cost-free local AI
3. **Test ANAF/ONRC** integrations with real CUI numbers
4. **Move cache to Redis** (currently in-memory, lost on restart)
5. **EC API status filtering** - results include all statuses; frontend filters
