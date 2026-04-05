# EU-Funds Local Production Readiness — Design Spec

**Date:** 2026-03-29
**Approach:** Parallel Tracks (Platform Fix + CLI Harness) with Convergence
**Scope:** Get EU-Funds running locally end-to-end, validate data quality, harden security, build operational tooling

---

## Constraints

- Everything runs locally — no cloud DB, no GCP dependencies
- AI providers called directly via API keys (OpenAI, Anthropic, Gemini) — no AI Gateway
- Cannot push to GitHub (would trigger production deploy)
- Qdrant runs locally in Docker; 28K chunks re-ingested from existing classified documents
- NotebookLM used as research tool only — synthesized insights exported to Obsidian vault, ingested into Qdrant through existing pipeline
- Primary focus: Romanian government funding calls (national + regional sources)

---

## Section 1: Local Infrastructure

### Docker Compose

Add Qdrant to the existing `docker-compose.yml` (which already defines Postgres 16 + Redis 7):

```yaml
qdrant:
  image: qdrant/qdrant:latest
  ports:
    - "6333:6333"
  volumes:
    - qdrant_data:/qdrant/storage
```

Add `qdrant_data` to the `volumes:` block.

### Environment Changes (`.env.local`)

```env
# Vector store — local Qdrant
VECTOR_PROVIDER=qdrant
QDRANT_URL=http://localhost:6333
# No QDRANT_API_KEY needed for local dev

# AI — direct provider calls, bypass gateway
# AI_GATEWAY_URL — remove or leave unset
OPENAI_API_KEY=<your-key>
ANTHROPIC_API_KEY=<your-key>
GOOGLE_AI_API_KEY=<your-key>

# Local auth
NEXTAUTH_URL=http://localhost:3000
```

### AI Client Modification (Required)

The current `lib/ai/client.ts` hard-requires the AI Gateway — `requireGatewayClient()` throws `serviceUnavailable` if `AI_GATEWAY_URL` is unset. There is no fallback to direct provider SDK calls.

**Fix:** Modify `client.ts` to support a direct-provider mode:
- When `AI_GATEWAY_URL` is set → use gateway (existing behavior)
- When `AI_GATEWAY_URL` is unset → instantiate provider SDKs directly (OpenAI, Anthropic, Gemini) based on `AI_PROVIDER` env var
- The three core functions (`aiGenerate`, `aiGenerateObject`, `aiEmbed`) need a provider-aware client factory that returns either the gateway client or a direct SDK client
- The Vercel AI SDK already supports multiple providers — leverage that instead of the OpenAI-compatible gateway shim

### Database Strategy

1. Start Postgres via Docker Compose
2. Attempt `npm run db:push` against local Postgres
3. If schema conflicts from stale data: wipe the Postgres volume, restart, re-run `db:push`
4. Run `npm run db:seed` for base data
5. Run `npx tsx scripts/seed-admin.ts` for admin user
6. Verify with `npm run db:studio`

### Knowledge Re-ingestion

1. Start local Qdrant via Docker Compose
2. Run `npx tsx scripts/bulk-ingest-rag-knowledge.ts` against local Qdrant
3. Source: already-classified documents in `scripts/classification-output/classification-results.json` (771 documents)
4. Embedding cost: ~$0.50-1.00 (28K chunks through `text-embedding-3-small`)
5. Verify with direct Qdrant API: `curl http://localhost:6333/collections/eu_legislation`

---

## Section 2: CLI Harness Architecture

### Overview

A Python + Click CLI that wraps EU-Funds' API routes and scripts. Lives at `app/agent-harness/`. Talks to the running Next.js app over HTTP — it's a client, not a code wrapper.

Requires the app to be running (`npm run dev`) for API commands. DB and RAG commands work directly without the app.

### Command Surface

```
fondeu health              # GET /api/health + /api/ready
fondeu db status           # Check Postgres connection, migration state
fondeu db migrate          # Run drizzle migrations
fondeu db seed             # Run seed scripts
fondeu db studio           # Launch Drizzle Studio

fondeu auth login          # Get session token (credentials flow)
fondeu auth whoami         # GET /api/auth/session

fondeu projects list       # GET /api/v1/projects
fondeu projects create     # POST /api/v1/projects
fondeu projects get <id>   # GET /api/v1/projects/<id>
fondeu projects compliance <id>  # GET /api/v1/projects/<id>/compliance

fondeu ai chat <message>   # POST /api/ai/chat
fondeu ai propose <id>     # POST /api/ai/generate-proposal
fondeu ai match <id>       # POST /api/ai/match-grants
fondeu ai eligibility <id> # POST /api/ai/check-eligibility
fondeu ai diagnose         # POST /api/ai/diagnostic

fondeu rag search <query>  # Search Qdrant directly (no app needed)
fondeu rag ingest          # Run bulk-ingest script
fondeu rag stats           # Collection info from Qdrant

fondeu calls list          # GET /api/v1/calls
fondeu calls verify <id>   # Fetch from live source, compare with stored
fondeu calls refresh       # Run crawlers, report changes

fondeu connectors list     # Show all 11+ connectors and status
fondeu connectors test     # Run all, report health
fondeu connectors test --source afm  # Test one
fondeu connectors run --source afm   # Fetch + parse + validate
fondeu connectors run --all          # Full refresh

fondeu test smoke          # Hit all endpoints, report pass/fail
fondeu test journey        # Full user journey end-to-end
fondeu test security       # CSRF, injection, auth bypass checks
```

### Output Modes

- Human-readable by default (tables, colored status)
- `--json` flag for structured output (agent consumption)

### Auth Handling

- `fondeu auth login` stores session token in `~/.fondeu/session.json`
- All subsequent commands use it automatically
- `fondeu test journey` creates a throwaway test user

### Installation

```bash
cd app/agent-harness
pip install -e .
```

Registers `fondeu` as a CLI command.

---

## Section 3: Web Verification & Freshness Layer

### Chunk Metadata Enrichment

Each RAG chunk in Qdrant carries:
- `source_url` — original page/PDF URL
- `last_verified` — timestamp of last successful verification
- `content_hash` — SHA-256 of source content at ingest time

### Verification Flow

Triggered by `fondeu calls verify <id>` or lazily at query time:

1. RAG returns chunks for a query
2. Check `last_verified` age per chunk
3. If older than threshold (default 7 days):
   - HTTP GET the `source_url`
   - Hash the content
   - Compare against stored `content_hash`
   - Match → update `last_verified` (data is current)
   - Mismatch → flag as `stale` (source content changed)
   - Unreachable → flag as `unverifiable`
4. Response includes freshness status per source

### UI Freshness Badges

RAG-grounded answers in the app UI show per-source freshness:
- **Verified** (green) — checked within threshold, content matches
- **Stale** (amber) — source changed since ingest, may be outdated
- **Unverified** (grey) — not checked recently or source unreachable

### Batch Refresh (`fondeu calls refresh`)

1. Run existing crawlers in `lib/connectors/`
2. Compare discovered calls against Postgres `funding_calls` + `discovered_calls`
3. Report: new calls, changed calls, dead links
4. Optionally re-ingest changed documents into Qdrant

### Non-blocking Design

Verification never blocks the RAG response. Stale data shows with a warning badge, not a loading spinner. Verification runs async or on explicit trigger.

---

## Section 4: Connector Hardening

### Problem

The 11 crawlers in `lib/connectors/` are bare Cheerio scrapers with no retry, no output validation, and no way to detect when a source site changes its HTML structure.

### Common Connector Contract

```typescript
interface ConnectorResult {
  source: string              // "afm" | "adr-nord-est" | "oportunitati-ue" | ...
  calls: DiscoveredCall[]     // normalized output
  meta: {
    fetched_at: string
    response_status: number
    content_hash: string
    structure_valid: boolean   // expected DOM selectors found?
    calls_found: number
  }
  errors: string[]
}
```

### Structure Validation

Each connector defines the CSS selectors / DOM patterns it expects. Before parsing, it checks those patterns exist in the response. If the site structure changed, it fails fast with `structure_valid: false` instead of silently producing wrong data.

### Hardening Priority (Romanian gov focus)

1. **Oportunitati UE Gov** — national, highest volume
2. **MIPE/MySMIS** — main EU funds portal for Romania
3. **AFM** — environment fund, active programs
4. **8 Regional ADRs** — similar structure, can share parsing logic
5. EC Portal — secondary
6. FNGCIMM — lower priority

### Harness ↔ Connector Boundary

The connectors are TypeScript code inside the Next.js app (`lib/connectors/`). The Python CLI harness does not reimplement them — it invokes them via:
- **HTTP:** `POST /api/admin/connectors/run?source=afm` (new thin API route that calls the existing crawler engine)
- **Fallback:** `npx tsx` subprocess for direct script execution if the app isn't running

The `ConnectorResult` contract is defined in TypeScript within the app. The harness consumes the JSON output.

### CLI Integration

All connectors testable and runnable through the harness:
```
fondeu connectors list
fondeu connectors test --source afm
fondeu connectors run --source afm
fondeu connectors run --all
```

---

## Section 5: Security Hardening (P0 Fixes)

### P0-1: CSRF Protection Gap

**Current state:** `/api/v1/*` and `/api/ai/*` routes exempted from CSRF in `middleware.ts`.

**Fix:** Remove blanket exemption. Apply CSRF validation (double-submit cookie pattern, already implemented in `lib/security/`) to all POST/PUT/DELETE routes. The CLI harness uses API key auth, not cookies, so it bypasses CSRF naturally.

### P0-2: Prompt Injection on AI Endpoints

**Current state:** User input passed directly into prompts without sanitization.

**Fix:** Add input sanitization in `lib/middleware/auth.ts` (alongside existing `withAIAuth`):
- Boundary markers around user input in all prompts: `<user_input>...</user_input>`
- Strip known injection patterns (system prompt overrides, role switches)
- Extend the RAG poisoning detection pattern from `pipeline.ts` to direct user input

### Validation via Harness

```
fondeu test security
```

- Attempt CSRF-less POST to protected endpoints → expect 403
- Send known prompt injection payloads to AI endpoints → expect sanitization
- Verify auth gates (unauthenticated → 401, wrong role → 403)

---

## Section 6: Convergence — Full User Journey Test

### The Journey (`fondeu test journey`)

```
 1. Register test user          POST /api/auth/register
 2. Verify email                POST /api/auth/verify-email
 3. Login, get session          POST /api/auth/callback/credentials
 4. Complete onboarding         topics/interests selection
 5. Create organization         POST /api/v1/organizations
 6. Create project              POST /api/v1/projects
 7. Upload test document        POST /api/documents/upload
 8. Match funding calls         POST /api/ai/match-grants
    → validates RAG returns results from local Qdrant
    → validates freshness metadata present
 9. Check eligibility           POST /api/ai/check-eligibility
    → validates deterministic rules engine
10. Generate proposal           POST /api/ai/generate-proposal
    → validates AI provider connectivity
    → validates prompt injection boundaries
11. Check compliance            GET /api/v1/projects/<id>/compliance
12. Verify audit integrity      POST /api/v1/audit/integrity
    → validates hash chain intact
13. Cleanup test data
```

### Pass/Fail Criteria

- All 13 steps complete → **PASS** (platform is production-ready for relaunch)
- Any step fails → report step number, error, response body
- Partial pass identifies exactly where the platform breaks

### What This Proves

- Local infrastructure works (Postgres, Redis, Qdrant)
- Auth flow complete (register → verify → login → session)
- AI providers respond through direct API calls
- Knowledge base searchable, returns relevant Romanian funding calls
- Security controls active (CSRF enforced, input sanitized)
- Audit trail intact (hash chain unbroken)

### After Journey Passes

Manual QA in the browser — walk through the Stitch UI, confirm frontend matches what the harness validated at API level. Platform is ready for production relaunch.

---

## Parallel Track Execution

### Track 1 — Platform (sequential)
1. Docker Compose + Qdrant service
2. DB migrations + seed
3. Env config fixes
4. Knowledge re-ingestion into local Qdrant
5. Verify app boots and auth works

### Track 2 — CLI Harness (starts after Track 1 step 1)
1. Design + scaffold harness
2. Implement core commands (health, db, rag, auth)
3. Implement domain commands (projects, ai, calls)
4. Implement connector commands
5. Implement test commands (smoke, journey, security)

### Convergence (both tracks complete)
1. Run `fondeu test smoke` — validate all endpoints
2. Fix P0 security issues
3. Harden priority connectors (Romanian gov sources)
4. Add web verification layer
5. Run `fondeu test journey` — full end-to-end validation
6. Manual QA in browser
7. Platform ready for relaunch

---

## Out of Scope

- GitHub push / CI/CD changes (would trigger deploy)
- Frontend changes beyond what's already in the 22 unpushed commits
- Full CLI Factory pipeline (Playwright capture → protocol detection → codegen)
- NotebookLM runtime integration (used as research tool only)
- Streaming for AI responses (important but separate effort)
- New feature development
- Billing/Stripe testing (separate concern)
