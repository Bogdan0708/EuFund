BrutalCode Agent 4 Review

  Scope Reviewed

  Project structure, AI architecture, database patterns, auth/security middleware, observability (logging/metrics), test
   quality and coverage, CI/CD pipeline, Dockerfile, deployment config, caching, env var management, connection
  management.

  Files/Areas Inspected

  ~120 files across: src/lib/ai/ (13.3K LOC), src/lib/db/, src/lib/auth/, src/lib/middleware/, src/lib/monitoring/,
  src/lib/errors/, src/lib/redis/, all 94 API routes, all 130 test files, middleware.ts, next.config.mjs,
  Dockerfile.production, infrastructure/Dockerfile.prod, cloudbuild.production.yaml, .github/workflows/ci.yml,
  vitest.config.ts.

  ---
  Critical Issues

  C1: Rate limiting completely disabled in production AI auth middleware

  - Severity: CRITICAL
  - File: src/lib/middleware/auth.ts:90
  - What: guardAIRequest() hardcodes tier: 'free' and returns remaining: 9999 — rate limiting is fully disabled. The
  comment says "Rate limiting disabled — single-user dev mode" but this is the production auth middleware.
  - Why it matters: Any authenticated user can make unlimited AI calls to OpenAI/Anthropic/Google. At $0.01-$0.15 per
  call, a single malicious or bugged client loop can run up thousands of dollars in AI costs within minutes.
  - Failure mode: Runaway AI costs. One user hammers /api/ai/generate-proposal in a loop → unbounded API spend with no
  circuit breaker at the billing level.
  - Fix: Re-enable the Redis-backed rate limiting that was disabled. The checkRateLimit function in redis/client.ts
  exists and works — it's just not being called.

  C2: Two completely parallel AI client systems (7K LOC of duplication)

  - Severity: CRITICAL (operational/cost)
  - File: src/lib/ai/orchestrator/gateway.ts + src/lib/ai/providers/router.ts
  - What: Two independent AI routing systems exist:
    a. providers/router.ts → providers/{openai,anthropic,google,perplexity}.ts (used by client.ts, agent/runtime.ts)
    b. orchestrator/gateway.ts → its own getClient() with duplicate provider switching (used by orchestrator engine)

  Both create separate OpenAI client singletons with different configs. The orchestrator gateway has its own
  retry/fallback logic that duplicates providers/retry.ts. The orchestrator gateway has different timeout values than
  providers/types.ts MODEL_CONFIGS.
  - Why it matters: Different retry policies, different fallback chains, different timeout values for the same models.
  When one breaks, the other might work — making bugs impossible to reproduce. 7K LOC maintaining two parallel paths to
  the same API endpoints.
  - Failure mode: You fix a bug in one client, the other still has it. Timeout mismatch: gateway.ts gives Claude Opus
  300s, providers/types.ts gives it 180s — same model, different behavior depending on code path.
  - Fix: Delete orchestrator/gateway.ts. Route all orchestrator calls through providers/router.ts. The agent system
  already does this correctly.

  C3: Dockerfile.production doesn't use Next.js standalone output correctly

  - Severity: CRITICAL
  - File: app/Dockerfile.production
  - What: Copies .next (full build output) AND node_modules (all deps). next.config.mjs sets output: 'standalone' which
  produces a self-contained server.js in .next/standalone/. But the Dockerfile copies the whole .next directory and full
   node_modules, defeating the purpose. The CMD is npm start (requires next binary) instead of node server.js.
  - Why it matters: Image is ~3-5x larger than needed. infrastructure/Dockerfile.prod does it correctly (node server.js,
   copies standalone), but app/Dockerfile.production does not.
  - Failure mode: Slow deploys, larger attack surface, npm start may not respect standalone config. Two Dockerfiles with
   different behavior — which one is actually used?
  - Fix: Delete app/Dockerfile.production. The infrastructure/Dockerfile.prod is the correct one (used by
  cloudbuild.production.yaml). Remove the old one to prevent confusion.

  ---
  High Severity Issues

  H1: AI orchestrator is dead code (3,959 LOC) but still actively imported

  - Severity: HIGH
  - File: src/lib/ai/orchestrator/ (3,959 LOC across ~20 files)
  - What: Memory says "Agent V3 is replacing V2 multi-agent pipeline." The agent/ directory (3,006 LOC) is the
  replacement. But the orchestrator still has 8 active API routes (/api/ai/orchestrator/*), and workspace utilities from
   orchestrator are imported by 11 non-orchestrator routes (sections, export, workspace).
  - Why it matters: The agent system imports types from orchestrator (agent/tools/*.ts imports orchestrator/types). Two
  AI systems with different architectures sharing type definitions creates a coupling that prevents removing either one.
  - Failure mode: New features get built on whichever system the developer finds first. Bugs fixed in agent may not be
  fixed in orchestrator. 4K LOC of dead engine that still needs to pass typecheck.
  - Fix: Extract shared types (SectionSpec, CallBlueprint, SectionResult) to src/lib/ai/types.ts. Move workspace
  utilities to src/lib/ai/workspace/. Then delete orchestrator engine/agents/prompts.

  H2: CI only runs 8 out of 130 test files

  - Severity: HIGH
  - File: .github/workflows/ci.yml
  - What: Security gates run 2 test files. Admin gates run 6 test files. build-and-test runs npm test which runs all
  tests — but only after the gated jobs pass. The ~122 other test files including all agent tests, all unit tests, all
  integration tests for auth, billing, consent, audit, etc. only run in build-and-test which is a downstream job.
  - Why it matters: The gate jobs create an illusion of staged testing but the real coverage gap is that there's no npm
  test in the quality or gate jobs. If build-and-test is the only job running the full suite, the earlier gates are
  security theater.
  - Failure mode: A PR passes quality + security-gates + admin-storage-gates (no full test run), reviewer sees green
  checks and merges before build-and-test finishes.
  - Fix: Move npm test (full suite) to the quality job or add it as a required check. The cherry-picked test files in
  gates add no value beyond what the full suite provides.

  H3: Metrics system is effectively dead

  - Severity: HIGH
  - File: src/lib/monitoring/metrics.ts
  - What: Custom in-memory Prometheus registry with counters, gauges, histograms — but only 4 files in the entire
  codebase actually call any metrics function: metrics.ts itself, circuit-breaker.ts, check-eligibility/route.ts, and
  middleware.ts. The middleware tracks HTTP request duration, but no AI calls, no DB queries, no auth events, no billing
   events emit metrics.
  - Why it matters: You have a /api/metrics endpoint that will return mostly zeros. The in-memory registry resets on
  every deploy/restart. No Prometheus is actually scraping this.
  - Failure mode: You think you have observability but you don't. AI costs spike → no metric to alert on. DB connection
  exhaustion → no metric. Rate limit bypasses (see C1) → no metric.
  - Fix: Either instrument the critical paths (AI calls, DB connection pool, Redis, auth failures) or remove the metrics
   system to avoid false confidence. Consider Cloud Run built-in metrics or Cloud Monitoring instead of rolling your
  own.

  H4: allowDangerousEmailAccountLinking: true on ALL OAuth providers

  - Severity: HIGH
  - File: src/lib/auth/index.ts:33-48
  - What: All four OAuth providers (Apple, Google, Microsoft, Facebook) have allowDangerousEmailAccountLinking: true.
  This means if an attacker creates an account on Provider A with victim's email, then signs in via Provider B, the
  accounts auto-link.
  - Why it matters: Account takeover vector. Attacker registers with victim's email on a provider that doesn't verify
  email (or during a verification bypass window), then uses that to access the victim's account.
  - Failure mode: Attacker creates Facebook account with target email → signs in → gets access to target's projects,
  AI-generated proposals, organization data.
  - Fix: Remove allowDangerousEmailAccountLinking from all providers. Implement explicit account linking flow where the
  user must prove ownership of the existing account before linking.

  ---
  Medium Severity Issues

  M1: No graceful shutdown handler

  - Severity: MEDIUM
  - File: Entire application
  - What: No SIGTERM/SIGINT handler. Cloud Run sends SIGTERM before killing the container. Without a handler, in-flight
  DB transactions, AI calls, and audit log writes are aborted mid-operation.
  - Why it matters: Audit hash chain corruption if a logAudit() is interrupted. Partial section saves. Orphaned Qdrant
  operations.
  - Fix: Add a shutdown handler in instrumentation.ts that closes DB pool, flushes Redis, and drains in-flight requests.

  M2: No connection pool monitoring

  - Severity: MEDIUM
  - File: src/lib/db/index.ts
  - What: max: 5 (Cloud SQL socket) or max: 10 (direct). With 94 API routes, many doing multiple DB queries, 5
  connections on Cloud Run (which can scale to many instances) is tight. No monitoring of pool exhaustion.
  - Why it matters: Under load, requests queue behind connection pool. No visibility into when this happens.
  - Fix: Add pool event listeners from postgres.js. Log when pool is at capacity. Consider increasing max for Cloud Run
  or using Cloud SQL Auth Proxy connection limits.

  M3: aiEmbedBatch creates a new OpenAI client per call

  - Severity: MEDIUM
  - File: src/lib/ai/client.ts:119-147
  - What: aiEmbed() does new OpenAI() on every call via dynamic import. aiEmbedBatch calls aiEmbed in a loop (batches of
   20 via Promise.all). Each embed call creates a new OpenAI instance.
  - Why it matters: Unnecessary object creation, no connection reuse. For batch operations this creates 20+ OpenAI
  clients.
  - Fix: Use a singleton like the provider system does. Or better, call the OpenAI batch embedding API directly (it
  accepts arrays).

  M4: Readiness probe is rate-limited via Redis

  - Severity: MEDIUM
  - File: src/app/api/ready/route.ts
  - What: The /api/ready endpoint is wrapped in withRateLimit backed by Redis. If Redis is down, the readiness probe
  might fail (depending on fail-open/closed behavior), causing Cloud Run to think the instance is unhealthy and kill it
  — cascading failure.
  - Why it matters: Readiness probes must be lightweight and dependency-free. A probe that depends on Redis can amplify
  Redis outages into full service outages.
  - Fix: Remove rate limiting from /api/ready. Readiness probes should return 200 unconditionally (or check only process
   health, not external deps).

  M5: Security headers set in both middleware.ts AND next.config.mjs

  - Severity: MEDIUM
  - File: src/middleware.ts:304-310 + next.config.mjs:44-52
  - What: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-XSS-Protection, Permissions-Policy are set in both
   locations. Middleware headers win for dynamic routes; next.config headers win for static. Drift between the two is
  inevitable.
  - Fix: Remove from next.config.mjs since middleware covers all routes (per the matcher config).

  M6: process.env scattered across 39 files with no validation

  - Severity: MEDIUM
  - File: 39 files using process.env directly
  - What: No central env validation. Each file reads process.env.X with its own fallback (or none). Some use ! non-null
  assertion (process.env.APPLE_CLIENT_ID!), some default to empty string, some throw.
  - Fix: Add a src/lib/config.ts with zod validation that fails fast at startup for required vars and provides typed
  access.

  ---
  Low Severity Issues

  L1: test-ai route accessible in non-production without any auth

  - File: src/app/api/test-ai/route.ts — no auth, makes real AI calls. Protected only by env check (production returns
  404) and middleware publicPaths (only added in dev). Low risk but sloppy.

  L2: ESLint ignoreDuringBuilds: true is permanent

  - File: next.config.mjs:11 — comment says "fix incrementally" but there's no tracking. Will never be fixed.

  L3: Pino logger not used in Edge runtime

  - File: src/middleware.ts:9-14 — rolls its own JSON logger because Pino can't run in Edge. This is fine but means
  middleware logs have different structure than server-side logs.

  L4: Two Dockerfiles with different configurations

  - File: app/Dockerfile.production (PORT 8080, npm start) vs infrastructure/Dockerfile.prod (PORT 3000, node
  server.js). The cloud build uses the infrastructure one. Delete the app-level one.

  ---
  Hidden Structural Problems

  1. The ai/ directory is 27% of total codebase (13.3K of 49K LOC). It contains two complete AI pipeline implementations
   (orchestrator + agent) that share types via cross-boundary imports but have independent client management, retry
  logic, and model routing. This is the single largest maintenance liability in the project.
  2. The orchestrator is load-bearing despite being "superseded". The workspace utilities (resolveProjectWorkspace,
  editProjectSection, normalizeSections, SectionVersionError, transitionSectionState) imported by 11+ API routes all
  live in orchestrator/. You can't delete orchestrator without migrating these utilities first.
  3. No test for the actual AI agent runtime loop. tests/unit/agent-runtime.test.ts exists, but the critical path — an
  actual user message going through tool selection, execution, and response — has no integration-level test. All agent
  tests mock the LLM call, so you're testing the mocking framework, not the agent.

  ---
  Most Suspicious Architectural/Operational Areas

  1. AI cost control: Rate limiting disabled (C1) + no cost metrics (H3) + no per-user spending caps = you are one
  runaway loop away from a surprise bill.
  2. Two AI routing systems: providers/router.ts and orchestrator/gateway.ts both route to the same APIs with different
  retry/timeout/fallback configs. This is a maintenance and debugging nightmare.
  3. The orchestrator/agent split: 7K LOC total for two systems doing the same job. The agent system depends on
  orchestrator types. Neither can be cleanly removed without surgery.
  4. CI test coverage: 130 test files, ~908 test cases, but CI cherry-picks 8 files for gates. The full suite only runs
  in a downstream job that might not block merge.

  ---
  Refactor Recommendations

  1. Kill the orchestrator engine (highest ROI). Extract workspace utils and shared types to neutral locations. Delete
  the orchestrator engine, agents, prompts, gateway, pubsub, and all 8 orchestrator API routes. This removes 3K+ LOC and
   the dual-client problem.
  2. Re-enable rate limiting. This is a 20-minute fix — call checkRateLimit() in guardAIRequest() and look up the user's
   actual tier from DB.
  3. Central config validation. Create src/lib/config.ts with zod that validates all required env vars at startup.
  Replace all 39 process.env callsites with typed imports.
  4. Fix CI to run full test suite as a required check. Move npm test to the quality job or make build-and-test a
  required status check.

  ---
  Quick Wins

  ┌─────┬────────────────────────────────────────────────────┬───────┬─────────────────────────────────────────────┐
  │  #  │                        Fix                         │ Time  │                   Impact                    │
  ├─────┼────────────────────────────────────────────────────┼───────┼─────────────────────────────────────────────┤
  │ 1   │ Re-enable rate limiting in middleware/auth.ts      │ 30    │ Prevents unlimited AI spend                 │
  │     │                                                    │ min   │                                             │
  ├─────┼────────────────────────────────────────────────────┼───────┼─────────────────────────────────────────────┤
  │ 2   │ Remove rate limit from /api/ready                  │ 5 min │ Prevents cascading failures during Redis    │
  │     │                                                    │       │ outage                                      │
  ├─────┼────────────────────────────────────────────────────┼───────┼─────────────────────────────────────────────┤
  │ 3   │ Delete app/Dockerfile.production                   │ 1 min │ Removes confusion about which Dockerfile is │
  │     │                                                    │       │  used                                       │
  ├─────┼────────────────────────────────────────────────────┼───────┼─────────────────────────────────────────────┤
  │ 4   │ Remove duplicate security headers from             │ 5 min │ Single source of truth                      │
  │     │ next.config.mjs                                    │       │                                             │
  ├─────┼────────────────────────────────────────────────────┼───────┼─────────────────────────────────────────────┤
  │ 5   │ Add npm test as required CI check                  │ 10    │ Actually run the tests you wrote            │
  │     │                                                    │ min   │                                             │
  ├─────┼────────────────────────────────────────────────────┼───────┼─────────────────────────────────────────────┤
  │ 6   │ Add SIGTERM handler in instrumentation.ts          │ 30    │ Clean shutdown on deploy                    │
  │     │                                                    │ min   │                                             │
  └─────┴────────────────────────────────────────────────────┴───────┴─────────────────────────────────────────────┘

  ---
  What I Would Rewrite First

  src/lib/ai/ — specifically, consolidate to a single client path.

  1. Move orchestrator/types.ts shared types (SectionSpec, CallBlueprint, SectionResult, SubmissionDocument) to
  src/lib/ai/types.ts
  2. Move workspace utilities to src/lib/ai/workspace/
  3. Delete orchestrator/gateway.ts, orchestrator/engine.ts, orchestrator/agents/*, orchestrator/prompts/*
  4. Delete the 8 orchestrator API routes
  5. The agent system + providers/router.ts becomes the single AI path

  This removes ~4K LOC, eliminates the dual-client problem, and makes the AI architecture actually match the folder
  structure instead of being "clean architecture cosplay" where two supposedly-separate systems share types across
  boundaries and route to the same APIs through different code paths.

✻ Cooked for 9m 34s

● Agent "Audit AI/agent architecture" completed

● Agent "Audit test quality and coverage" completed

● Agent "Audit middleware/security/config" completed

● Agent "Audit DB schema and queries" completed

● All four background agents have completed. The report I compiled above already incorporates the key findings. Let me
  update it with the most important additional findings from the agents that I didn't already cover.

  ---
  Addendum from Deep-Dive Agents

  Additional Critical/High findings not in main report:

  C4: Diagnostic endpoint reuses AI Gateway API key for auth
  - File: src/app/api/ai/diagnostic/route.ts:12-13
  - What: Falls back to process.env.AI_GATEWAY_API_KEY if HEALTHCHECK_AUTH_TOKEN isn't set. The AI service credential
  becomes the diagnostic auth token — no separation of concerns.
  - Fix: Use a dedicated DIAGNOSTIC_AUTH_TOKEN. Never reuse service credentials for ops access.

  H5: Five missing database indexes on hot paths
  - projects — no index on user_id (every project list query)
  - project_documents — no index on version DESC (latest version lookup)
  - workflow_messages — no index on (session_id, created_at DESC) (message history)
  - users.email — no index (login, account linking)
  - No full-text index on projects.title (search uses ILIKE)
  - Fix: Add these 5 indexes. The projects query will do sequential scans under load without them.

  H6: 98% of integration tests mock the database — only 1 test hits a real DB
  - Only rls-postgres-enforcement.test.ts connects to PostgreSQL
  - All other 66 integration tests mock @/lib/db with chainable stubs
  - Agent runtime/orchestrator engine tests mock the LLM call, so they test state machine wiring, not actual behavior
  - Zero tests for: Stripe webhooks, email delivery, vector search, AI tool execution, DOCX export
  - Fix: Add 5-10 real-DB integration tests for critical flows (project CRUD, section versioning, audit chain).
  Configure vitest coverage thresholds.

  H7: CSRF token expires after 1 hour — bad UX for long-running grant applications
  - File: src/middleware.ts:292 — maxAge: 3600
  - Users working on multi-hour EU grant applications will get 403 on their next save
  - Fix: Increase to 24h or implement silent refresh via background fetch.

  M7: RLS policies on project_documents use nested subqueries
  - The rls.sql policies join through projects to check ownership, which can cause slow full-table scans on large
  document sets
  - Fix: Consider a materialized view for user-accessible project IDs, or add a denormalized user_id column on
  frequently-accessed child tables.

  M8: Audit log table is append-only with no partitioning
  - audit_log will grow unbounded (every consent change, every login, every data mutation)
  - No partition by month/year, no archival strategy
  - Fix: Partition by created_at month. The retention cleanup exists but doesn't address table bloat from retained rows.

  ---
  The main report above plus these addendum items cover every material finding. The top 3 actions by impact:

  1. Re-enable AI rate limiting (C1) — prevents runaway API costs
  2. Consolidate the dual AI client systems (C2/H1) — eliminates 4K LOC and the impossible-to-debug dual routing
  3. Fix CI to run full test suite as a gate (H2) — you have 130 test files but only 8 run before merge