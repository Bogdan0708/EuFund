BrutalCode Agent 2 Review

  Scope Reviewed

  API routes (94 files), orchestrator engine, agent runtime, gateway, middleware (auth/rate-limit/tier-gate),
  validators, RAG pipeline, vector store, audit logging, discovery pipeline, connectors, integrations, export pipeline,
  session management, pub/sub streaming, knowledge write-back, model routing.

  Files/Areas Inspected

  ~40 files read in full, ~180 files inventoried. Focus on the highest-risk areas: AI orchestration, auth/authz, CRUD
  routes, document pipeline, streaming infrastructure, error handling.

  ---
  Critical Issues

  C1. Rate Limiting Disabled Across All AI Endpoints

  - File: app/src/lib/middleware/auth.ts:90-91
  - Function: guardAIRequest()
  - What: Rate limiting is hardcoded to return { remaining: 9999 } with comment "Rate limiting disabled — single-user
  dev mode"
  - Why it matters: All AI endpoints are unmetered. A single authenticated user can burn unlimited OpenAI/Anthropic
  tokens. This is the production auth middleware — not a test stub.
  - Production failure mode: Token budget exhaustion, runaway costs from any authenticated user or session hijack. No
  per-tier enforcement exists.
  - Fix: Re-enable the Redis rate limiting logic that was commented out. Gate the dev-mode bypass behind NODE_ENV ===
  'development'.

  C2. User Tier Always Hardcoded to 'free'

  - File: app/src/lib/middleware/auth.ts:87
  - Function: guardAIRequest()
  - What: tier: 'free' as UserTier — the session user's actual tier is never read from DB or session.
  - Why it matters: The tier is used downstream for model routing decisions (resolveAgentModel()), feature gating, and
  rate limit configuration. Every user gets free tier regardless of what the DB says.
  - Production failure mode: Paying users get free tier model routing (budget models instead of premium). Tier-gated
  features silently fail.
  - Fix: Read tier from the user session or DB query, consistent with the tier enum in the schema.

  C3. Orchestrator processMessage Runs Fire-and-Forget With No Error Propagation

  - File: app/src/app/api/ai/orchestrator/message/route.ts:90-95
  - Function: POST()
  - What: processMessage(...) runs as a detached Promise.then().catch() — the route returns 202 Accepted before knowing
  if processing will succeed.
  - Why it matters: Combined with the lock fail-open behavior (acquireLock returns true when Redis is down), there's no
  mechanism to detect that a message was silently dropped. The client sees 202 but the SSE stream may never emit events.
  - Production failure mode: User sends message, gets 202, opens SSE stream, waits indefinitely. No timeout on client
  side. No dead-letter for failed processing.
  - Fix: At minimum, persist a "processing_started" event in the DB before returning 202 so the SSE stream can detect
  stale processing. Add a message processing timeout.

  C4. Session Lock Fails Open — Concurrent Mutation Possible

  - File: app/src/app/api/ai/orchestrator/message/route.ts:46-53
  - Function: acquireLock()
  - What: If Redis is unavailable (getRedis() returns null or redis.set() throws), the lock silently returns true.
  - Why it matters: Two concurrent messages to the same session will both acquire the "lock" and both call
  processMessage(). The session context will have race conditions on step advancement, context updates, and workflow
  messages.
  - Production failure mode: Duplicate section generation, corrupted workflow context, step counter desynchronization.
  This is the exact class of bug the lock was supposed to prevent.
  - Fix: Fail-closed for the lock. If Redis is down, return 503 "Session processing temporarily unavailable" instead of
  silently allowing concurrent mutation.

  ---
  High Severity Issues

  H1. Organization Routes Missing Authorization — Any User Can Read/Update/Delete Any Org

  - File: app/src/app/api/v1/organizations/[id]/route.ts:18-141
  - Functions: GET(), PUT(), DELETE()
  - What: All three handlers call requireAuth() but never check if the user is a member of the organization. The query
  uses raw db.query.organizations.findFirst() — no RLS, no membership check.
  - Why it matters: Any authenticated user can read org details (including CUI, tax info, members), update org fields,
  or soft-delete any org.
  - Production failure mode: Full IDOR on organizations. A user creates an account and can enumerate/modify/delete every
   org in the system.
  - Fix: Add withUserRLS() wrapper or explicit orgMembers check. The projects route does this correctly — orgs should
  follow the same pattern.

  H2. Organization Members Route — Any User Can List/Add/Remove Members of Any Org

  - File: app/src/app/api/v1/organizations/[id]/members/route.ts:26-184
  - Functions: GET(), POST(), DELETE()
  - What: GET lists all members of any org ID. POST adds a user to any org. DELETE removes any member from any org. None
   check if the caller has admin/org_admin role in the target org.
  - Why it matters: Any authenticated user can add themselves as org_admin to any org, then access that org's projects
  and data.
  - Production failure mode: Complete org takeover. Privilege escalation from viewer to admin in any org.
  - Fix: All three handlers must verify the caller has at least org_admin role in the target org. Use requireOrgRole()
  from auth helpers.

  H3. SQL Injection via ilike Search Parameter

  - File: app/src/app/api/v1/projects/route.ts:99,155
  - Function: GET()
  - What: ilike(projects.title, '%${search}%') — the search param is interpolated into a LIKE pattern without escaping %
   or _ characters.
  - Why it matters: While Drizzle parameterizes the value (preventing true SQL injection), % and _ are LIKE wildcards. A
   user sending search=%%% matches everything. More critically, if the search value is ever concatenated outside
  parameterization, it's a direct injection vector.
  - Production failure mode: Search bypass, potential DoS via expensive LIKE %_%_%_% patterns on unindexed columns.
  - Fix: Escape % and _ in search input: search.replace(/%/g, '\\%').replace(/_/g, '\\_').

  H4. Audit Hash Chain Has Race Condition Under Concurrent Writes

  - File: app/src/lib/legal/audit.ts:134-206
  - Function: logAudit()
  - What: The transaction reads the latest entryHash, inserts a new row, computes hash, updates the row. But the SELECT
  for the latest hash doesn't take a FOR UPDATE lock — two concurrent logAudit() calls can both read the same
  previousHash and create a fork in the chain.
  - Why it matters: This is a tamper-evident hash chain. A fork means verifyAuditChainIntegrity() will report tampering
  when there was none — destroying trust in the entire audit system.
  - Production failure mode: Audit chain verification fails on next GDPR audit. False positive tamper detection.
  - Fix: Add FOR UPDATE to the latest-hash select, or use a dedicated audit_chain_head single-row table with row-level
  locking.

  H5. SSE Stream Creates New Redis Connection Per Client — No Connection Pooling

  - File: app/src/app/api/ai/orchestrator/stream/route.ts:91
  - Function: GET()
  - What: Each SSE client creates new Redis(process.env.REDIS_URL) inside the ReadableStream callback. There's no
  connection pool, no max connection limit, and no cleanup on server restart.
  - Why it matters: Each active user holds an open Redis connection for the entire SSE session (potentially 5+ minutes
  for a workflow). 100 concurrent users = 100 Redis connections.
  - Production failure mode: Redis maxclients exhaustion. New connections rejected, all streaming breaks simultaneously.
  - Fix: Use a shared subscriber with channel multiplexing, or use the existing getRedis() subscriber instance. The
  ioredis library supports this natively.

  ---
  Medium Severity Issues

  M1. Project Detail GET Leaks DB Data Without RLS for projectDocuments

  - File: app/src/app/api/v1/projects/[id]/route.ts:48-54
  - Function: GET()
  - What: latestDoc query uses raw db.select() (not withUserRLS()). While the project itself is loaded with RLS, the
  metadata query bypasses it.
  - Fix: Wrap in withUserRLS() or ensure the where clause includes the project ownership check.

  M2. processMessage Recursive Call Can Stack Overflow

  - File: app/src/lib/ai/orchestrator/engine.ts:297
  - Function: processMessage()
  - What: Auto-advance uses return processMessage(sessionId, input, stream, gateway, true, livePrefs) — recursive call.
  Steps 1→2→3→4→5 means up to 4 levels of recursion if none hit checkpoints. Each level holds the full stack frame.
  - Fix: Convert to iterative loop with while (shouldAutoAdvance).

  M3. Token Split Estimation is a Guess — 70/30 Split

  - File: app/src/lib/ai/orchestrator/agents/build.ts:136-137
  - What: tokensIn: Math.round(result.tokensUsed * 0.7), tokensOut: Math.round(result.tokensUsed * 0.3) — fabricated
  ratio, not actual usage.
  - Why it matters: Token usage tracking for billing/analytics is systematically wrong. Actual input/output ratios vary
  wildly by model and prompt length.
  - Fix: The OpenAI SDK returns prompt_tokens and completion_tokens separately. Propagate these through the gateway.

  M4. Gateway Fallback Can Silently Change Models Mid-Section-Generation

  - File: app/src/lib/ai/orchestrator/gateway.ts:147-153
  - Function: callWithRetry()
  - What: On primary+retry failure, falls back to a completely different provider/model. A section being generated with
  claude-opus-4-6 can silently complete with gpt-5.4.
  - Why it matters: Different models produce different quality/style. The metadata.model field records the requested
  model, not the one that actually generated the content.
  - Fix: Return the actual provider/model used alongside the response. Record it in section metadata.

  M5. Duplicate Input Sanitization — withAIAuth and authenticateAIUser Copy-Pasted

  - File: app/src/lib/middleware/auth.ts:98-137 and 139-179
  - What: The input sanitization block (body parsing, field scanning) is copy-pasted identically in both functions.
  - Fix: Extract to a shared function. This is a maintenance hazard — a fix in one copy won't reach the other.

  M6. Injection Detection is Log-Only — Never Blocks

  - File: app/src/lib/middleware/auth.ts:113-119
  - What: When sanitizeUserInput() detects injection patterns, it logs a warning but allows the request to proceed.
  - Why it matters: The injection detection is security theater. Detected attacks are logged but executed.
  - Fix: Return 400 when injection is detected, or at minimum strip the detected patterns before passing to AI.

  M7. createPubSubStream.send() Silently Swallows All Errors

  - File: app/src/lib/ai/orchestrator/pubsub.ts:84-86
  - What: .catch(() => undefined) on every event persistence. If DB/Redis is down, every event is silently dropped.
  - Fix: At minimum count dropped events and emit a warning. Consider a local buffer with retry.

  M8. Rate Limiter Fails Open When Redis Is Down

  - File: app/src/lib/middleware/rate-limit.ts:83-85
  - Function: enforceRateLimit()
  - What: catch (error) { return { ok: true, headers: {} } } — any Redis failure allows the request through.
  - Why it matters: CLAUDE.md states "Redis fail-closed for AI endpoints" but the middleware fails open. The documented
  behavior doesn't match the code.
  - Fix: Add a failClosed option to RateLimitOptions and honor it for AI endpoints.

  ---
  Low Severity Issues

  L1. IP Extraction Skips Rate Limit When No IP Found

  - File: app/src/lib/middleware/rate-limit.ts:54-57
  - What: If neither x-forwarded-for nor x-real-ip is present, rate limiting is skipped entirely.
  - Fix: Use a fallback key (e.g., unknown-ip) to at least apply a global fallback limit.

  L2. Search on ilike(projects.title, ...) Without Index

  - File: app/src/app/api/v1/projects/route.ts
  - What: ILIKE '%search%' cannot use a B-tree index. On a large projects table this is a full table scan.
  - Fix: Add pg_trgm index or use full-text search.

  L3. Auto-Created Personal Org Has Hardcoded orgType: 'pfa'

  - File: app/src/app/api/v1/projects/route.ts:43
  - What: Personal workspace auto-created with orgType: 'pfa' (Persoană Fizică Autorizată). This is a legal entity type,
   not a "personal workspace."
  - Fix: Use a dedicated personal org type or altul.

  L4. Consent Schema Allows Only marketing and analytics — No privacy_policy/terms_of_service

  - File: app/src/app/api/auth/consent/route.ts:54
  - What: The PATCH schema restricts to ['marketing', 'analytics'], but the DB has privacy_policy, terms_of_service,
  data_processing consent types.
  - Fix: This may be intentional (required consents can't be withdrawn via this route), but should be documented.

  ---
  Hidden Structural Problems

  S1. Two Parallel Orchestration Systems

  The codebase has both an orchestrator engine (lib/ai/orchestrator/engine.ts — 5-step workflow with agents) and an
  agent runtime (lib/ai/agent/runtime.ts — tool-loop with phase transitions). Both have their own sessions tables
  (workflowSessions vs agentSessions), their own state management, their own persistence logic. This is not refactored
  code — both are actively used by different routes.

  Impact: Duplicated business logic, two different authorization models, two different error handling approaches, two
  different streaming mechanisms. Bug fixes in one don't propagate to the other.

  S2. No Transaction Boundaries Around Multi-Step Mutations

  In handleWorkflowCompletion() (engine.ts:325-441), the code creates a project, inserts projectDocuments, generates
  DOCXs, uploads to GCS, inserts projectFiles, and updates projectDocuments metadata — all as separate DB operations. If
   any step fails, you get a partially created project with missing docs.

  S3. Gateway Hardcodes Provider URLs — No Environment Override

  The gateway (gateway.ts:14-43) hardcodes Anthropic, Google, and Perplexity base URLs. There's no ANTHROPIC_BASE_URL or
   similar override. This prevents using proxy gateways, local dev servers, or the AI Gateway service that's documented
  in MEMORY.md.

  ---
  Most Suspicious Handlers/Services

  1. /api/v1/organizations/[id]/route.ts — No authorization at all. Read/update/delete any org.
  2. /api/v1/organizations/[id]/members/route.ts — Full IDOR. Add yourself as admin to any org.
  3. /api/ai/orchestrator/message/route.ts — Fire-and-forget processing, fail-open lock.
  4. lib/middleware/auth.ts — Rate limit disabled, tier hardcoded, injection detection is log-only.
  5. lib/ai/orchestrator/engine.ts — Recursive auto-advance, no transaction boundaries on completion.

  ---
  Refactor Recommendations

  1. Extract authorization middleware: Create requireOrgMember(orgId, userId) and requireOrgAdmin(orgId, userId)
  helpers. Apply consistently to all org/* routes.
  2. Unify orchestration systems: The dual orchestrator/agent runtime is the biggest structural debt. Pick one and
  migrate.
  3. Make the gateway return actual metadata: Provider, model, input tokens, output tokens, latency. Stop guessing.
  4. Transaction boundaries: Wrap handleWorkflowCompletion() in a single transaction with GCS cleanup on rollback.
  5. Connection-pool the SSE Redis subscribers: One shared subscriber, channel multiplexing.

  ---
  Quick Wins

  1. Re-enable rate limiting — remove the // Rate limiting disabled block and the hardcoded tier. This is 5 lines.
  2. Add org membership checks — requireOrgRole() already exists. Just call it in the org routes. ~10 lines per route.
  3. Escape LIKE wildcards in search — one utility function, apply in 2 places.
  4. Add FOR UPDATE to audit hash chain — 1 line change, fixes race condition.
  5. Block injection instead of logging — change the warn+continue to return 400. ~3 lines.
  6. Fix gateway to return actual model used — thread the fallback model name back through the response.

  ---
  What I Would Rewrite First

  Organization authorization (H1, H2). This is the most dangerous finding — full IDOR on org data and membership. It's
  exploitable today by any authenticated user. Fix is straightforward: add requireOrgRole() to all org routes. Takes 30
  minutes, eliminates the worst vulnerability.

  Second priority: Re-enable rate limiting and tier lookup (C1, C2). The entire billing and model-routing system is dead
   code because the middleware always returns free tier with unlimited requests. This is a cost exposure issue.
