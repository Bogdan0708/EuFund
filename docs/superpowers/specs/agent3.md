BrutalCode Agent 3 Review

  Scope Reviewed

  Database schema, ORM queries, RLS policies, authentication/authorization, session handling, CSRF, API route security,
  input validation, file handling, secrets exposure, audit logging, webhook verification, external integrations, GDPR
  data paths, tenant isolation.

  Files/Areas Inspected

  - app/src/lib/db/schema.ts — All 50+ tables
  - app/src/lib/db/index.ts — Connection + withUserRLS
  - app/src/lib/db/rls.sql — RLS policies (8 tables)
  - app/src/lib/auth/index.ts — NextAuth config
  - app/src/lib/auth/helpers.ts — requireAuth, requirePlatformAdmin
  - app/src/lib/auth/edge.ts — Edge session decode
  - app/src/lib/storage/gcs.ts — File storage
  - app/src/middleware.ts — Global middleware
  - 90+ route.ts files across /api/
  - Webhook, integration, admin, document, project, org routes

  ---
  Critical Issues

  C1. Organization routes have ZERO ownership checks — any authenticated user can read/update/delete ANY org

  Severity: CRITICAL
  File: app/src/app/api/v1/organizations/[id]/route.ts:18-54 (GET), :56-104 (PUT), :106-141 (DELETE)
  What: GET/PUT/DELETE only call requireAuth() then fetch org by ID. No check that the user is a member of that
  organization. Any logged-in user can read any org's details (including members), update any org's fields, or
  soft-delete any org.
  Why it matters: Complete tenant boundary breach. User A can delete User B's organization, modify their
  CUI/name/address, see all member data.
  Failure mode: Attacker enumerates UUIDs, reads all orgs, modifies competitor data, deletes organizations.
  Fix: After requireAuth(), verify orgMembers membership: requireOrgRole(user.id, id, 'viewer') for GET,
  requireOrgRole(user.id, id, 'org_admin') for PUT/DELETE.

  C2. Organization verify route — no membership check, any user can trigger ONRC lookup and overwrite org data

  Severity: CRITICAL
  File: app/src/app/api/v1/organizations/[id]/verify/route.ts:16-105
  What: Calls requireAuth() but never checks if the user belongs to the org. Any authenticated user can trigger ONRC
  verification for any org, which overwrites the org's name, address, CAEN codes, and registration number with external
  data.
  Why it matters: Data integrity destruction. Attacker can overwrite verified org data with potentially stale or
  incorrect ONRC data for orgs they don't own.
  Fix: Add requireOrgRole(user.id, id, 'org_admin') before the verification.

  C3. Organization members route — no role check for adding/removing members

  Severity: CRITICAL
  File: app/src/app/api/v1/organizations/[id]/members/route.ts:26-184
  What: GET lists any org's members (no membership check). POST adds members to any org (no admin check). DELETE removes
   members from any org (no admin check). Only requireAuth() is called.
  Why it matters: Any user can add themselves as org_admin to any organization, then control that org. Any user can
  remove all members from any org. This is a complete privilege escalation vector.
  Fix: GET: require viewer+ membership. POST: require org_admin. DELETE: require org_admin.

  C4. allowDangerousEmailAccountLinking: true on ALL OAuth providers

  Severity: CRITICAL
  File: app/src/lib/auth/index.ts:33,38,43,48
  What: All four OAuth providers (Apple, Google, Microsoft, Facebook) have allowDangerousEmailAccountLinking: true. This
   means if an attacker controls any email address (e.g., creates a Facebook account with victim's email), they get
  automatic access to the victim's existing account.
  Why it matters: Account takeover. Attacker creates a social account with your email, logs in via OAuth, gets linked to
   your real account with all your data and org memberships.
  Fix: Remove allowDangerousEmailAccountLinking: true from all providers. Implement proper account linking that requires
   the user to be already authenticated.

  C5. RLS covers only 8 of 50+ tables — massive tenant isolation gap

  Severity: CRITICAL
  File: app/src/lib/db/rls.sql
  Tables with RLS: projects, project_documents, project_files, workflow_sessions, workflow_messages, notifications,
  consent_records, audit_log
  Tables WITHOUT RLS: organizations, org_members, documents, users, ai_reviews, work_packages, project_timelines,
  risk_assessments, compliance_checks, compliance_reports, project_comments, project_versions, agent_sessions,
  agent_sections, agent_section_versions, agent_messages, team_members, user_preferences, signature_workflows, and 20+
  more
  Why it matters: Any query using db directly (not withUserRLS) bypasses all tenant isolation. Even withUserRLS only
  protects the 8 listed tables. Queries against organizations, documents, ai_reviews, work_packages, etc. have zero RLS
  protection.
  Fix: Add RLS policies for all tenant-scoped tables, or enforce application-level ownership checks consistently.

  ---
  High Severity Issues

  H1. CSP report endpoint has wildcard CORS — can be used as a log injection vector

  Severity: HIGH
  File: app/src/app/api/csp-report/route.ts:58-67
  What: OPTIONS handler returns Access-Control-Allow-Origin: *. The POST handler parses untrusted JSON and logs it to
  console with no validation or rate limiting.
  Why it matters: Anyone can flood your logs with arbitrary data. Log injection can corrupt monitoring, trigger false
  alerts, or exhaust disk/log storage.
  Fix: Remove wildcard CORS. Add rate limiting. Validate the JSON structure matches CSP report format.

  H2. GDPR data export has unbounded audit log query

  Severity: HIGH
  File: app/src/app/api/auth/export/route.ts:91-102
  What: db.select(...).from(auditLog).where(eq(auditLog.userId, authUser.id)).orderBy(desc(auditLog.createdAt)) — no
  LIMIT. For a power user, this could return millions of rows.
  Why it matters: DoS vector. A user who has been active for months/years will have a massive audit trail. This query
  will exhaust server memory and timeout.
  Fix: Add pagination or a reasonable LIMIT (e.g., 10000 most recent entries). For full export, implement streaming or
  async export with email delivery.

  H3. Project files route does NOT use RLS — uses db directly with userId check

  Severity: HIGH
  File: app/src/app/api/v1/projects/[id]/files/route.ts:36-39 and :77-80
  What: Uses db.select()...where(eq(projects.userId, user.id)) directly instead of withUserRLS. This bypasses RLS
  policies entirely. The project_files table HAS RLS enabled but the query goes through the non-RLS connection.
  Why it matters: If the DB role used by the app is the table owner (common), RLS is bypassed. The application-level
  userId check partially compensates but misses team member access.
  Fix: Use withUserRLS(user.id, ...) for all queries in this route, which will also automatically grant team member
  access via the RLS policy.

  H4. Project files — hard delete instead of soft delete, no audit log

  Severity: HIGH
  File: app/src/app/api/v1/projects/[id]/files/[fileId]/route.ts:99-105
  What: DELETE route calls db.delete(projectFiles) (hard delete) and deleteObject(file.storagePath) with no logAudit().
  Compare to the documents route which does soft delete + audit.
  Why it matters: Irrecoverable data loss with no audit trail. Cannot investigate who deleted what or recover
  accidentally deleted files.
  Fix: Soft delete (set deletedAt), add logAudit(), delete storage blob only after retention period.

  H5. user.isPlatformAdmin from session used for status transition check without DB verification

  Severity: HIGH
  File: app/src/app/api/v1/projects/[id]/route.ts:177
  What: if (!user.isPlatformAdmin && nextStatus === 'depus') uses user.isPlatformAdmin from the session JWT, not from a
  fresh DB query. The CLAUDE.md explicitly warns: "requirePlatformAdmin() always hits DB — never trust session alone for
   admin checks."
  Why it matters: Stale session attack. User is granted admin, gets a JWT with isPlatformAdmin=true, admin is revoked in
   DB, but user's JWT still allows setting projects to "depus" status until token expires (24h).
  Fix: Call requirePlatformAdmin() instead of checking the session flag.

  H6. Diagnostic endpoint accepts AI_GATEWAY_API_KEY as auth token

  Severity: HIGH
  File: app/src/app/api/ai/diagnostic/route.ts:12
  What: const expectedToken = process.env.HEALTHCHECK_AUTH_TOKEN || process.env.AI_GATEWAY_API_KEY; — if
  HEALTHCHECK_AUTH_TOKEN is not set, the AI gateway API key is used for auth. The diagnostic response leaks env var
  presence/absence info.
  Why it matters: If someone compromises the AI gateway key, they also get diagnostic access which reveals database
  status, Redis status, table existence, and AI model info.
  Fix: Require a dedicated HEALTHCHECK_AUTH_TOKEN. Never reuse API keys for authentication.

  H7. Content-Disposition header injection in document download

  Severity: HIGH
  File: app/src/app/api/documents/[id]/route.ts:99
  What: Content-Disposition: attachment; filename="${doc.filename}" — the filename comes from DB (originally from user
  upload), and while it's sanitized on upload, it's not re-sanitized on download. If the sanitization is ever bypassed
  or DB is modified directly, this allows header injection.
  Fix: Re-sanitize filename on every download: encodeURIComponent(doc.filename). The project files route at
  [fileId]/route.ts:59 correctly uses encodeURIComponent — this inconsistency confirms the gap.

  ---
  Medium Severity Issues

  M1. requireOrgRole exists in helpers.ts interface but is never imported or used anywhere

  Severity: MEDIUM
  File: app/src/lib/auth/helpers.ts
  What: The CLAUDE.md documents requireOrgRole(userId, orgId, minRole) but grepping shows it's never defined or used.
  The function doesn't exist.
  Why it matters: Every org route is supposed to use this for role-based access control, but it was never implemented.
  This is why C1/C2/C3 exist.
  Fix: Implement requireOrgRole() and add it to all org-scoped routes.

  M2. Approvals route allows any org_admin to approve — no check that reviewer isn't the project creator

  Severity: MEDIUM
  File: app/src/app/api/v1/approvals/route.ts:103-176
  What: resolveAdminOrgId only checks if user is an admin in any org, then allows them to approve projects in that org.
  No separation-of-duties check (creator !== reviewer).
  Why it matters: Project creator who is also org_admin can approve their own project.
  Fix: Add check: if (project.createdBy === user.id) throw Errors.forbidden().

  M3. Project status transition from verificare → ciorna on reject loses work

  Severity: MEDIUM
  File: app/src/app/api/v1/approvals/route.ts:130
  What: Rejection sets status back to ciorna (draft). This is a semantic downgrade that could confuse the system about
  the project's lifecycle.
  Why it matters: A project that went through multiple review cycles could be silently reset. Better to have a respins
  (rejected) status.
  Fix: Use respins for rejection, or create a separate rejected status.

  M4. QES (Qualified Electronic Signature) routes trust client-provided documentId without ownership verification

  Severity: MEDIUM
  File: app/src/app/api/integrations/qes/prepare-document/route.ts:10
  What: Accepts documentId from request body and passes it to prepareDocument(). No check that the authenticated user
  owns this document.
  Why it matters: Any user can initiate e-signature workflows on documents they don't own, potentially signing on behalf
   of others.
  Fix: Verify document ownership before allowing signature preparation.

  M5. Search parameter used in ILIKE without escaping special characters

  Severity: MEDIUM
  File: app/src/app/api/v1/projects/route.ts:100,156
  What: ilike(projects.title, \%${search}%`)— ifsearchcontains%or_, it matches more broadly than intended. Not SQL
  injection (Drizzle parameterizes), but semantic injection.   **Why it matters:** User can search with %to get all
  projects, or_to match single characters as wildcards. Could leak project titles in the no-org fallback path.
  **Fix:** Escape%and_in search parameter:search.replace(/%/g, '\%').replace(/_/g, '\_')`.

  M6. Account deletion doesn't invalidate active sessions

  Severity: MEDIUM
  File: app/src/app/api/auth/account/route.ts:77-109
  What: Account is anonymized in DB but the user's JWT session (24h TTL) remains valid. After "deleting" their account,
  the user can still make API calls until the token expires.
  Why it matters: GDPR right-to-erasure expects immediate cessation of access. Also, passwordHash is NOT cleared — it
  should be nulled.
  Fix: Add passwordHash: null to the anonymization. Implement session invalidation (e.g., increment a tokenVersion field
   checked on each request).

  M7. RLS policy references team_members table but team_members has no RLS itself

  Severity: MEDIUM
  File: app/src/lib/db/rls.sql:36-39
  What: The projects_user_isolation policy does a subquery on team_members to check member access. But team_members
  itself has no RLS, so a malicious transaction could potentially insert a fake team_members row before the RLS check.
  Why it matters: If the app has any code path that allows users to write to team_members without proper authorization,
  they can grant themselves access to any project.
  Fix: Add RLS to team_members table, or ensure all team_members writes go through application-level authorization.

  ---
  Low Severity Issues

  L1. test-ai route only checks NODE_ENV, not auth

  File: app/src/app/api/test-ai/route.ts:6
  What: Returns 404 in production but has no auth in dev. It calls aiGenerate() which costs real API tokens.
  Fix: Add auth even in dev, or remove the route entirely.

  L2. CSP connect-src allows https://api.anthropic.com — client-side AI API calls?

  File: app/src/middleware.ts:31
  What: CSP allows browser connections to api.anthropic.com. If AI calls are server-side, this shouldn't be in CSP.
  Fix: Remove if not needed client-side; if it is needed, ensure no API keys are exposed to the client.

  L3. Project files upload doesn't validate magic bytes

  File: app/src/app/api/v1/projects/[id]/files/route.ts:108-114
  What: Trusts file.type from the client. Compare to /api/documents/upload which validates magic bytes.
  Fix: Add magic byte validation like the documents upload route.

  L4. CSRF token has 1-hour maxAge — too short for long sessions

  File: app/src/middleware.ts:293
  What: CSRF cookie expires in 1 hour but session lasts 24 hours. Users will get mysterious 403 errors on forms they
  left open.
  Fix: Match CSRF cookie TTL to session TTL (24h).

  L5. Signed In event logs email in plaintext

  File: app/src/lib/auth/index.ts:151
  What: log.info(\[AUDIT] User signed in: ${user.email}`)logs the email address.   **Fix:** Hash or mask the email in
  logs:user.email.replace(/(.{2}).+(@.+)/, '$1***$2')`.

  ---
  Hidden Structural Problems

  1. requireOrgRole doesn't exist — The entire org authorization model described in CLAUDE.md was never implemented.
  Every org route is wide open.
  2. Dual ownership models — Projects have both orgId (org-based) and userId (user-based) ownership. Some routes check
  orgId via orgMembers, others check userId directly, some check neither. This creates confusion about who can access
  what.
  3. RLS vs application-level auth mismatch — Some routes use withUserRLS (trusting DB policies), others use db directly
   with manual WHERE clauses. The two systems don't agree on what "authorized" means. Routes using db directly bypass
  all RLS.
  4. No rate limiting on org mutation routes — Creating organizations, adding members, verifying orgs via ONRC — none of
   these have rate limits. An attacker could create thousands of orgs or trigger thousands of ONRC lookups.
  5. Agent/session tables have RLS but agent routes may bypass — agent_sessions, agent_sections etc. are defined in
  schema but RLS policies only cover workflow_sessions/workflow_messages. The newer agent tables lack RLS policies
  entirely.

  ---
  Most Suspicious Queries/Auth Paths/Integrations

  1. /api/v1/organizations/[id] PUT — Any authenticated user can overwrite any organization's data
  2. /api/v1/organizations/[id]/members POST — Any user can add themselves as admin to any org
  3. /api/v1/organizations/[id]/verify POST — Any user can trigger ONRC data overwrite on any org
  4. /api/v1/approvals POST — Self-approval possible (creator = reviewer)
  5. /api/auth/export GET — Unbounded audit log query, potential OOM
  6. /api/integrations/qes/prepare-document POST — No document ownership check
  7. OAuth allowDangerousEmailAccountLinking — Account takeover via social login
  8. /api/v1/projects/[id] PUT line 177 — Trusts session for isPlatformAdmin

  ---
  Refactor Recommendations

  1. Implement requireOrgRole() — This is the single biggest security win. One function, deployed across all org routes.
  2. Standardize on withUserRLS everywhere — Ban direct db usage in route handlers. Lint rule: no-restricted-imports for
   db in route files.
  3. Add RLS policies to all tenant-scoped tables — At minimum: organizations, org_members, documents, ai_reviews,
  work_packages, project_timelines, risk_assessments, compliance_checks, agent_sessions/sections/messages.
  4. Remove allowDangerousEmailAccountLinking — Implement proper account linking flow.
  5. Centralize authorization middleware — Instead of repeating auth checks in every route, create a route wrapper:
  withAuth(handler, { requireOrg: true, minRole: 'viewer' }).

  ---
  Quick Wins

  ┌──────────────────────────────────────────────────────────┬────────────────────────────┬────────┐
  │                           Fix                            │           Files            │ Effort │
  ├──────────────────────────────────────────────────────────┼────────────────────────────┼────────┤
  │ Add org membership check to org routes                   │ 4 route files              │ 30 min │
  ├──────────────────────────────────────────────────────────┼────────────────────────────┼────────┤
  │ Remove allowDangerousEmailAccountLinking                 │ auth/index.ts              │ 5 min  │
  ├──────────────────────────────────────────────────────────┼────────────────────────────┼────────┤
  │ Add LIMIT to GDPR export audit query                     │ auth/export/route.ts       │ 5 min  │
  ├──────────────────────────────────────────────────────────┼────────────────────────────┼────────┤
  │ Replace user.isPlatformAdmin with requirePlatformAdmin() │ projects/[id]/route.ts:177 │ 10 min │
  ├──────────────────────────────────────────────────────────┼────────────────────────────┼────────┤
  │ Add magic byte validation to project files upload        │ files/route.ts             │ 15 min │
  ├──────────────────────────────────────────────────────────┼────────────────────────────┼────────┤
  │ Add audit logging to project file delete                 │ files/[fileId]/route.ts    │ 10 min │
  ├──────────────────────────────────────────────────────────┼────────────────────────────┼────────┤
  │ Escape ILIKE wildcards in search                         │ projects/route.ts          │ 5 min  │
  ├──────────────────────────────────────────────────────────┼────────────────────────────┼────────┤
  │ Fix CSRF cookie TTL mismatch                             │ middleware.ts              │ 5 min  │
  ├──────────────────────────────────────────────────────────┼────────────────────────────┼────────┤
  │ Null passwordHash on account deletion                    │ auth/account/route.ts      │ 5 min  │
  └──────────────────────────────────────────────────────────┴────────────────────────────┴────────┘

  ---
  What I Would Rewrite First

  requireOrgRole() + all organization routes. This is a five-alarm fire. Any authenticated user on the platform can:
  1. Read any organization's data and member list
  2. Add themselves as admin to any organization
  3. Update or delete any organization
  4. Trigger ONRC verification that overwrites org data

  The fix is straightforward:
  1. Implement requireOrgRole(userId, orgId, minRole) in auth/helpers.ts
  2. Add it to every route under /api/v1/organizations/[id]/
  3. Add it to the approvals route
  4. Add a self-approval guard

  Then immediately remove allowDangerousEmailAccountLinking from all OAuth providers — this is a known account takeover
  vector that NextAuth explicitly warns about in its documentation.

✻ Cogitated for 9m 58s

● Agent "Audit auth &amp; session security" completed

● Agent "Audit DB schema &amp; queries" completed

● Agent "Audit API routes &amp; validation" completed

● Agent "Audit secrets, files, privacy" completed

● All 4 agents have completed. The report I compiled above already incorporates findings from my direct reads. Let me
  add the key additional findings from the agents that I didn't already cover.

  ---
  Additional Findings from Agent Reports

  C6. SPARQL Injection in EUR-Lex integration

  Severity: CRITICAL
  File: app/src/lib/integrations/eurlex/client.ts:70-84
  What: User search query is interpolated into SPARQL REGEX filter. Escaping only handles \ and ", but SPARQL regex
  metacharacters (.*, |, ()) pass through.
  Why it matters: ReDoS via crafted regex patterns. Data exfiltration via SPARQL alternation.
  Fix: Whitelist safe characters: query.replace(/[^a-zA-Z0-9\s-]/g, ''), or use CONTAINS() instead of REGEX().

  H8. Missing timeouts on external API fetch calls

  Severity: HIGH
  File: app/src/lib/integrations/eurlex/client.ts:86,136, app/src/lib/integrations/cordis/client.ts:44
  What: fetch() calls to EUR-Lex SPARQL endpoint and CORDIS API have no signal: AbortSignal.timeout().
  Why it matters: Requests can hang forever, exhausting connection pool and causing cascading failures.
  Fix: Add signal: AbortSignal.timeout(10000) to all external fetch calls.

  H9. Stripe webhook has no replay protection

  Severity: HIGH
  File: app/src/app/api/webhooks/stripe/route.ts
  What: Signature is verified but event ID is not deduplicated. Stripe retries and replayed payloads (with valid
  signatures from within the tolerance window) are processed multiple times.
  Why it matters: Duplicate billing operations — subscriptions created twice, trial resets applied multiple times.
  Fix: Add a stripe_webhook_events table, check event ID uniqueness before processing.

  M8. Project files route uses raw db instead of withUserRLS — missing team access

  Severity: MEDIUM
  File: app/src/app/api/v1/projects/[id]/files/route.ts, [fileId]/route.ts
  What: Both routes use db.select()...where(eq(projects.userId, user.id)) directly instead of withUserRLS. This means
  team members (from team_members table) are excluded — they get 404 even though RLS would grant them access.
  Fix: Switch to withUserRLS(user.id, ...) for all queries.

  M9. Missing UUID validation on all organization routes

  Severity: MEDIUM
  File: All routes under app/src/app/api/v1/organizations/[id]/
  What: No UUID format validation on params.id. Projects route correctly validates with UUID_RE.test(id), but org routes
   don't.
  Fix: Add UUID validation as first check in every org route handler.

  L6. Audit DLQ path has insecure default

  Severity: LOW
  File: app/src/lib/legal/audit.ts:13
  What: Default ./tmp/audit-dlq.log may be world-readable. Failed audit entries (which contain metadata, action types,
  resource IDs) could leak.
  Fix: Use a path with restrictive permissions, create directory with mode: 0o700.

  ---
  Final Priority Matrix

  ┌──────────────────────┬────────────────────────────────────────────────────┬───────────────────────────────┐
  │       Priority       │                       Issue                        │            Impact             │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P0 — Fix today       │ C1-C3: Org routes missing membership checks        │ Any user can control any org  │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P0 — Fix today       │ C4: allowDangerousEmailAccountLinking on all OAuth │ Account takeover              │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P0 — Fix today       │ C5: RLS on 8/50+ tables only                       │ Tenant isolation Swiss cheese │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P1 — Fix this week   │ C6: SPARQL injection                               │ Data exfiltration/ReDoS       │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P1 — Fix this week   │ H1: CSP log injection                              │ Log flooding                  │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P1 — Fix this week   │ H5: Session isPlatformAdmin trusted                │ 24h stale privilege window    │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P1 — Fix this week   │ H8: Missing fetch timeouts                         │ Cascading failures            │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P1 — Fix this week   │ H9: Webhook replay                                 │ Duplicate billing             │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P2 — Fix this sprint │ H2: Unbounded GDPR audit export                    │ OOM/DoS                       │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P2 — Fix this sprint │ H3-H4: Project files bypass RLS, hard delete       │ Data loss, no audit           │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P2 — Fix this sprint │ M1: Implement requireOrgRole()                     │ Systematic auth fix           │
  ├──────────────────────┼────────────────────────────────────────────────────┼───────────────────────────────┤
  │ P2 — Fix this sprint │ M6: Account deletion doesn't invalidate sessions   │ GDPR gap                      │
  └──────────────────────┴────────────────────────────────────────────────────┴───────────────────────────────┘

  The single highest-leverage fix: implement requireOrgRole() and add it to all org routes. This closes C1, C2, C3, and
  M2 in one pass.