Execution Plan: Workspace Audit Fixes + Platform Security Hardening

 Context

 8 independent code reviews (4 workspace-scoped, 4 full-platform) identified 47 unique issues across security, data
 integrity, UX, and architecture. The most severe are platform-wide security gaps (org auth missing, OAuth account
 takeover, rate limiting disabled) that predate the workspace feature. The workspace feature itself has a CSRF bypass
 that makes it non-functional, RLS bypasses, and client-side race conditions.

 This plan prioritizes by blast radius: platform security first, then workspace correctness, then operational/polish.

 ---
 Phase 1: P0 Security (blocks any deploy)

 Task 1.1: Implement requireOrgRole() + lock down org routes

 Why: Any authenticated user can read/update/delete ANY org, add themselves as admin, trigger ONRC overwrites. Full
 IDOR + privilege escalation.
 Files:
 - Create helper: app/src/lib/auth/helpers.ts — add requireOrgRole(userId, orgId, minRole)
 - Fix: app/src/app/api/v1/organizations/[id]/route.ts — GET: viewer+, PUT: org_admin, DELETE: org_admin
 - Fix: app/src/app/api/v1/organizations/[id]/members/route.ts — GET: viewer+, POST: org_admin, DELETE: org_admin
 - Fix: app/src/app/api/v1/organizations/[id]/verify/route.ts — POST: org_admin
 - Fix: app/src/app/api/v1/organizations/[id]/audit/route.ts — GET: viewer+
 - Fix: app/src/app/api/v1/organizations/[id]/approvals/route.ts — add self-approval guard
 - Fix: app/src/app/api/v1/organizations/[id]/ai-reviews/route.ts — GET: viewer+
 Refs: requirePlatformAdmin() in helpers.ts for the DB-query pattern. Schema: orgMembers table has role column with
 org_role_enum.

 Task 1.2: Remove allowDangerousEmailAccountLinking from all OAuth providers

 Why: Account takeover — attacker creates social account with victim's email, gets auto-linked to victim's real
 account.
 Files:
 - Fix: app/src/lib/auth/index.ts — remove allowDangerousEmailAccountLinking: true from lines 33, 38, 43, 48

 Task 1.3: Re-enable AI rate limiting + tier lookup

 Why: Rate limiting hardcoded to remaining: 9999, tier hardcoded to 'free'. Any user can make unlimited AI calls.
 Runaway API costs.
 Files:
 - Fix: app/src/lib/middleware/auth.ts — in guardAIRequest():
   - Read actual user tier from DB (or session) instead of tier: 'free' as UserTier
   - Call checkRateLimit() from @/lib/redis/client.ts instead of returning { remaining: 9999 }
   - Gate dev-mode bypass behind NODE_ENV === 'development'

 Task 1.4: Fix CSRF on all workspace + project mutation fetches

 Why: Middleware enforces CSRF on PATCH/POST. Section editor uses bare fetch(). Every auto-save returns 403. Feature is
  non-functional.
 Files:
 - Fix: app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx — import and use csrfFetch from
 @/lib/csrf/client for save()
 - Fix: app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx — lines 318-333, 369-385 (submission doc PATCH) — use
 csrfFetch
 Refs: useOrchestrator.ts and useAgent.ts both import csrfFetch + bootstrapCSRFToken — follow same pattern.

 Task 1.5: Fix RLS bypass in workspace.ts

 Why: Only the project lookup uses withUserRLS. All session, document, and version queries use bare db. Either data
 leaks or queries silently fail when RLS is enforced.
 Files:
 - Fix: app/src/lib/ai/orchestrator/workspace.ts — wrap resolveProjectWorkspace body in withUserRLS for all queries
 - Fix: editProjectSection — use withUserRLS for the transaction
 - Fix: syncProjectDocumentSnapshot — make it private (unexport), require userId parameter, use withUserRLS
 - Fix: reconcileDrift — use withUserRLS for reads/writes
 - Fix: app/src/app/api/v1/workspace/route.ts — all 4 queries must use withUserRLS
 Refs: withUserRLS pattern in app/src/lib/db/index.ts:57. Every other project route uses it.

 Task 1.6: Fix isPlatformAdmin session trust

 Why: CLAUDE.md says "requirePlatformAdmin() always hits DB". Project status transition trusts stale session JWT.
 Files:
 - Fix: app/src/app/api/v1/projects/[id]/route.ts:177 — replace user.isPlatformAdmin check with requirePlatformAdmin()

 ---
 Phase 2: Data Integrity & Feature Correctness

 Task 2.1: Fix section editor state management (stale closures + unmount + error display)

 Why: Two independent debounce paths with cross-dependencies create stale-closure bugs. No unmount cleanup. Silent save
  failures.
 Files:
 - Rewrite: app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx
   - Create a single ref latestRef = useRef({ content, title }) updated on every change
   - Single scheduleSave() function that reads from latestRef.current (never stale)
   - Manual save cancels pending timer (already partially done)
   - Title onChange triggers same debounced save path
   - Add unmount cleanup: useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, [])
   - Add error message on generic save failure: setError(t('saveError')) in catch block
   - Add saveError i18n key to both locale files
   - Add navigation guard: check isDirty before router.push() in breadcrumb

 Task 2.2: Fix MDXEditor controlled/uncontrolled conflict

 Why: MDXEditor's markdown prop is initial-only. After save or conflict, editor shows stale content.
 Files:
 - Fix: app/src/components/editor/section-editor.tsx — add key prop support so parent can force remount
 - Fix: page.tsx — pass key={versionRef.current} to SectionEditor to force remount on version change

 Task 2.3: Guard completed sessions from edits

 Why: resolveProjectWorkspace returns completed sessions for write operations. Corrupts finalized data.
 Files:
 - Fix: app/src/lib/ai/orchestrator/workspace.ts — in editProjectSection, add: if (session.status === 'completed')
 throw new SectionVersionError('SessionCompleted', ...)
 - Alternatively: add a forEditing parameter to resolveProjectWorkspace that excludes completed sessions

 Task 2.4: Fix reconcileDrift write-on-read race

 Why: Writes to session context without FOR UPDATE lock. Two concurrent GETs can corrupt state.
 Files:
 - Fix: app/src/lib/ai/orchestrator/workspace.ts — either:
   - (a) Wrap reconcileDrift in db.transaction() with FOR UPDATE on the session row, OR
   - (b) Remove reconcileDrift from read path entirely; trigger only on edit conflict
 - Also: batch the N+1 version row fetches into a single WHERE (sessionId, sectionId, version) IN (...) query

 Task 2.5: Fix audit hash chain race condition

 Why: Two concurrent logAudit() calls can both read the same previousHash, forking the chain. False tamper detection on
  GDPR audit.
 Files:
 - Fix: app/src/lib/legal/audit.ts:134-206 — add FOR UPDATE to the latest-hash SELECT

 Task 2.6: Make session lock fail-closed

 Why: If Redis is down, acquireLock returns true. Two concurrent messages mutate the same session.
 Files:
 - Fix: app/src/app/api/ai/orchestrator/message/route.ts:46-53 — return 503 when Redis is unavailable instead of
 allowing concurrent mutation

 ---
 Phase 3: Operational & API Hardening

 Task 3.1: Add rate limiting to new workspace endpoints

 Files:
 - Fix: app/src/app/api/v1/projects/[id]/sections/[sectionId]/route.ts — wrap PATCH in withRateLimit
 - Fix: app/src/app/api/v1/projects/[id]/sections/[sectionId]/state/route.ts — wrap POST in withRateLimit
 - Fix: export routes — add rate limiting

 Task 3.2: Add sectionId UUID validation to all [sectionId] routes

 Files: All 3 [sectionId] route files — add UUID_RE.test(sectionId) check matching existing id validation pattern.

 Task 3.3: Add audit logging to export endpoints

 Files:
 - Fix: app/src/app/api/v1/projects/[id]/export/route.ts — add logAudit({ action: 'project.export', ... })
 - Fix: app/src/app/api/v1/projects/[id]/sections/[sectionId]/export/route.ts — same

 Task 3.4: Fix workspace aggregate performance

 Files:
 - Fix: app/src/app/api/v1/workspace/route.ts — add .limit(1) per-project for documents query, or use DISTINCT ON /
 window function for session selection per spec guidance

 Task 3.5: Remove dynamic imports in state route

 Files:
 - Fix: app/src/app/api/v1/projects/[id]/sections/[sectionId]/state/route.ts:54-56 — replace with static imports

 Task 3.6: Encode export filenames + truncate

 Files: Both export route files — use encodeURIComponent() for Content-Disposition filenames, truncate to 100 chars.

 Task 3.7: Pass locale to error responses

 Files: All 7 new route files — detect locale from request URL or Accept-Language instead of hardcoding 'ro'.

 ---
 Phase 4: UX & i18n Fixes

 Task 4.1: Fix navigation 404s

 - Fix: app/src/app/[locale]/(dashboard)/panou/page.tsx:207 — novo → nou
 - Fix: app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx:585,593 — add /${locale} prefix to AI resume nav

 Task 4.2: Fix i18n gaps in workspace UI

 - Add missing uploadedFilesHint, saveError, loadError keys to both locale files
 - Fix formatRelativeTime in documente/page.tsx to use i18n
 - Fix hardcoded "Failed to load section" in editor page
 - Fix SectionStateBadge to use useTranslations instead of parallel locale prop

 Task 4.3: Fix read-only link accessibility

 - Fix: SectionsTabContent.tsx:100-110 — render <span> instead of <a href={undefined}> when readOnly

 Task 4.4: Consolidate project detail fetches

 - Fix: proiecte/[id]/page.tsx:462-513 — single useEffect with Promise.all instead of 3 cascading fetches

 Task 4.5: Extract UUID_RE to shared constant

 - Create: app/src/lib/validators/uuid.ts — export UUID_RE
 - Update all 5+ route files that duplicate it

 ---
 Phase 5: Cleanup & Tech Debt (non-blocking)

 Task 5.1: Delete dead code

 - Delete app/src/hooks/useCSRF.ts (dead — nobody imports it)
 - Delete app/Dockerfile.production (wrong config — infrastructure/Dockerfile.prod is used)
 - Remove duplicate security headers from next.config.mjs (middleware covers all routes)

 Task 5.2: Fix CI to run full test suite as required check

 - Fix: .github/workflows/ci.yml — move npm test to quality job or make build-and-test a required status check

 Task 5.3: Fix CSRF cookie TTL mismatch

 - Fix: app/src/middleware.ts:293 — increase CSRF cookie maxAge from 1 hour to 24 hours (match session TTL)

 Task 5.4: Add LIMIT to GDPR export audit query

 - Fix: app/src/app/api/auth/export/route.ts:91-102 — add .limit(10000) or implement pagination

 Task 5.5: Remove readiness probe rate limiting

 - Fix: app/src/app/api/ready/route.ts — remove withRateLimit wrapper to prevent cascading failures

 ---
 Verification

 After each phase:
 1. cd app && npx vitest run — all tests pass
 2. cd app && npx tsc --noEmit — zero type errors
 3. cd app && npm run lint — no new lint errors
 4. cd app && npm run build — build succeeds

 After Phase 1 specifically:
 - Verify org routes return 403 for non-members (manual test or new integration test)
 - Verify section editor auto-save works (CSRF token present in request headers)
 - Verify workspace queries use RLS (check for withUserRLS in all query paths)

 After Phase 2:
 - Verify concurrent save doesn't create duplicate versions (manual test: type + click save immediately)
 - Verify MDXEditor updates after save (version number bumps, editor reflects saved content)

 ---
 Execution Order

 Phases 1-2 are merge blockers. Phase 3 is high priority. Phases 4-5 can follow as separate commits.

 Within Phase 1, tasks 1.1 (org auth) and 1.4 (CSRF) are the two most impactful — one is a platform-wide IDOR, the
 other makes the workspace feature non-functional.