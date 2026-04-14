 All 4 agents complete. Here's the combined executive summary.

  ---
  Combined Brutal Review: Document Workspace Feature

  Overall Verdict

  DO NOT MERGE. The domain model is sound — session-backed edits, optimistic locking, state machine, drift
  reconciliation — but the implementation has security regressions, a broken CSRF path that prevents the feature from
  working at all, and test coverage that provides false confidence. The RLS bypass alone is a blocking defect that
  contradicts the established security posture of every other endpoint in the codebase.

  Top 15 Problems

  #: 1
  Sev: CRIT
  Issue: CSRF token missing on all PATCH/POST fetches — middleware enforces CSRF on mutations, but the editor page uses
    bare fetch(). Auto-save and manual save will 403 on every request. Feature is non-functional.
  Source: Agent 1
  Files: sectiuni/[sectionId]/page.tsx:67
  ────────────────────────────────────────
  #: 2
  Sev: CRIT
  Issue: RLS bypass on sessions, documents, and version queries — only the project lookup uses withUserRLS; all
    subsequent queries use bare db. Either data leaks or queries silently return empty in production. Every other
  project
     endpoint uses RLS.
  Source: Agents 2,3,4
  Files: workspace.ts:81-100,122-195,214-338
  ────────────────────────────────────────
  #: 3
  Sev: CRIT
  Issue: reconcileDrift writes to session context without FOR UPDATE lock — a read-modify-write race on JSONB during
  what
     should be a GET request. Two concurrent reads can corrupt session state.
  Source: Agents 2,3
  Files: workspace.ts:176-185
  ────────────────────────────────────────
  #: 4
  Sev: CRIT
  Issue: No rate limiting on any new endpoint — the PATCH endpoint triggers a transaction, SHA-256 hashing, version
    insert, audit log, snapshot sync, and pubsub on every call. Unbounded.
  Source: Agents 3,4
  Files: All 6 route files
  ────────────────────────────────────────
  #: 5
  Sev: CRIT
  Issue: Workspace aggregate bypasses RLS and loads unbounded data — projectDocuments query has no user filter and no
    LIMIT. Ignores spec's window function guidance.
  Source: Agents 2,3,4
  Files: workspace/route.ts:53-57
  ────────────────────────────────────────
  #: 6
  Sev: HIGH
  Issue: Stale closure on title in debounced save — content change timer captures title at callback creation time. Title

    edits within the 3s window are lost. Mirror problem exists on title change handler capturing stale content.
  Source: Agent 1
  Files: page.tsx:103, 160-167
  ────────────────────────────────────────
  #: 7
  Sev: HIGH
  Issue: MDXEditor controlled/uncontrolled conflict — markdown prop is initial value only, not reactive. After save or
    conflict resolution, editor shows stale content. No ref or key mechanism to force update.
  Source: Agent 1
  Files: section-editor.tsx:69
  ────────────────────────────────────────
  #: 8
  Sev: HIGH
  Issue: Debounce timer not cleaned up on unmount — navigating away fires save() on unmounted component. Memory leak +
    potential data corruption from stale closure.
  Source: Agent 1
  Files: page.tsx:33,101-104
  ────────────────────────────────────────
  #: 9
  Sev: HIGH
  Issue: Editing completed sessions allowed — resolveProjectWorkspace returns completed sessions for write operations.
    editProjectSection doesn't check session status. Corrupts finalized data.
  Source: Agent 3
  Files: workspace.ts:63,108
  ────────────────────────────────────────
  #: 10
  Sev: HIGH
  Issue: Export endpoints not audit-logged — AuditAction includes 'project.export' and 'document.download' but neither
    export route calls logAudit. GDPR compliance gap.
  Source: Agent 3
  Files: Both export routes
  ────────────────────────────────────────
  #: 11
  Sev: HIGH
  Issue: sectionId URL parameter never validated — project id gets UUID validation, sectionId does not. Any arbitrary
    string propagates into version rows, audit entries, events.
  Source: Agents 2,3
  Files: All [sectionId] routes
  ────────────────────────────────────────
  #: 12
  Sev: HIGH
  Issue: Save error shows nothing to user — catch block sets saveStatus='error' but never sets error message. The UI
    shows error only when saveStatus === 'error' && error. Non-409 failures are silent.
  Source: Agent 1
  Files: page.tsx:88-92,188
  ────────────────────────────────────────
  #: 13
  Sev: HIGH
  Issue: Tests mock so aggressively they can't catch real bugs — createChainMock mocks every Drizzle method as identity
    functions. Tests pass even if wrong table is queried, wrong filters applied, or RLS is bypassed. Zero coverage of
    reconcileDrift.
  Source: Agent 4
  Files: workspace.test.ts:48-62
  ────────────────────────────────────────
  #: 14
  Sev: HIGH
  Issue: syncProjectDocumentSnapshot exported without authorization — any caller with a projectId can overwrite snapshot

    data. No user check, no RLS.
  Source: Agent 3
  Files: workspace.ts:366-396
  ────────────────────────────────────────
  #: 15
  Sev: MED
  Issue: Post-commit snapshot sync reads stale session — re-reads session outside transaction. Concurrent edit can
    overwrite snapshot with wrong data.
  Source: Agents 2,4
  Files: workspace.ts:346-353

  Production Readiness Risks

  1. Feature is DOA — CSRF enforcement means every save request returns 403. Cannot ship.
  2. Data isolation — RLS bypass means cross-tenant data access is possible if userId is ever wrong. The
  projectDocuments query in the workspace aggregate has zero user filtering.
  3. Data corruption — reconcileDrift writes on reads without locks. Two browser tabs on the same project corrupt
  session context.
  4. Resource exhaustion — No rate limiting + unbounded workspace aggregate = easy DoS by authenticated users.
  5. Stale UI — MDXEditor won't reflect server-side updates. Conflict resolution shows a message but the editor content
  is stale.

  Architectural Debt

  - JSONB dual-write: sections live in workflowSessions.context, section_versions, and projectDocuments.sections. Three
  copies, one source of truth (JSONB), compensated by drift reconciliation and snapshot sync. Every write must update
  all three or accept divergence.
  - Read-path mutations: reconcileDrift runs on GET requests and writes to the database. This violates HTTP semantics
  and creates write contention on reads.
  - God module embryo: workspace.ts (397 lines) handles normalization, resolution, drift reconciliation, editing (with
  transaction management), and snapshot sync. Five responsibilities.
  - Two markdown renderers: react-markdown for previews, @mdxeditor/editor for editing. Different rendering, double
  bundle cost (~250KB gzipped client addition).

  Security/Integrity Risks

  - RLS bypass on 90% of workspace queries
  - CSRF not applied to mutation requests from frontend
  - syncProjectDocumentSnapshot exported without auth guard
  - No rate limiting on write endpoints
  - Export endpoints unaudited (GDPR gap)
  - Content-Disposition headers not RFC 5987 encoded (non-ASCII title injection)
  - Error responses leak internal details (VersionIntegrityMismatch exposes hash values)
  - All error responses hardcoded to Romanian locale

  Performance Risks

  - Workspace aggregate loads ALL sessions and ALL documents for 50 projects — unbounded rows
  - reconcileDrift does N+1 queries (one per drifted section) on every read
  - normalizeSections computes SHA-256 for every section missing a hash — up to 1000 hashes on workspace load
  - editProjectSection post-commit re-reads the session (wasted query, already had the data)
  - MDXEditor re-creates plugin array on every render (potential re-initialization)

  Maintainability Score: 4/10

  The domain model is well-designed. The spec is thorough. But the implementation has too many security shortcuts, too
  many silent failure modes, and tests that verify mock wiring instead of behavior. The JSONB dual-write creates
  permanent maintenance overhead.

  Refactor Priority Order

  1. Fix CSRF — import csrfFetch in section editor page. Feature literally doesn't work without this.
  2. Fix RLS — wrap ALL workspace DB queries in withUserRLS. Security blocker.
  3. Add rate limiting — withRateLimit() on PATCH and POST endpoints minimum.
  4. Fix stale closures — create useAutoSave hook with a single ref for latest {content, title}.
  5. Add unmount cleanup — clear debounce timer on component unmount.
  6. Fix MDXEditor — use key={versionRef.current} to force re-mount on server updates, or use editor ref.
  7. Guard completed sessions — reject edits when session.status === 'completed'.
  8. Add sectionId validation — UUID regex check in all [sectionId] routes.
  9. Add audit logging to exports — logAudit({ action: 'project.export' }).
  10. Rewrite reconcileDrift — batch version fetches, move out of read path or add FOR UPDATE lock.
  11. Rewrite tests — either test pure functions only or use a real test database.
  12. Optimize workspace aggregate — use DISTINCT ON or window function, add LIMIT to document query.

  7-Day Fix Plan

  ┌─────┬────────────────────────────────────────────────────────────────────────────────────────────┬──────────────┐
  │ Day │                                            Work                                            │   Blocker?   │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────────┼──────────────┤
  │ 1   │ Fix CSRF (import csrfFetch), fix save error display, add unmount cleanup, fix stale        │ Merge        │
  │     │ closures via useAutoSave hook                                                              │ blocker      │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────────┼──────────────┤
  │ 2   │ Wrap all workspace.ts queries in withUserRLS, unexport syncProjectDocumentSnapshot         │ Merge        │
  │     │                                                                                            │ blocker      │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────────┼──────────────┤
  │ 3   │ Add withRateLimit to all new endpoints, add sectionId validation, guard completed sessions │ Merge        │
  │     │                                                                                            │ blocker      │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────────┼──────────────┤
  │ 4   │ Fix MDXEditor controlled value issue, add audit logging to exports, encode export          │ High         │
  │     │ filenames                                                                                  │ priority     │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────────┼──────────────┤
  │ 5   │ Rewrite reconcileDrift (batch queries, add FOR UPDATE or move to explicit repair), remove  │ High         │
  │     │ post-commit session re-read                                                                │ priority     │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────────┼──────────────┤
  │ 6   │ Replace mock-chain tests with real integration tests or pure-function-only unit tests      │ Medium       │
  │     │                                                                                            │ priority     │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────────┼──────────────┤
  │ 7   │ Optimize workspace aggregate (window function, bounded queries), fix i18n gaps (error      │ Medium       │
  │     │ responses, formatRelativeTime, hardcoded strings)                                          │ priority     │
  └─────┴────────────────────────────────────────────────────────────────────────────────────────────┴──────────────┘

  What Should Be Deleted, Rewritten, or Simplified Immediately

  ┌──────────┬─────────────────────────────────────┬────────────────────────────────────────────────────────────────┐
  │  Action  │               Target                │                              Why                               │
  ├──────────┼─────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Delete   │ reconcileDrift from read path       │ GET requests should not write. Move to an explicit repair      │
  │          │                                     │ endpoint or trigger only on edit conflict.                     │
  ├──────────┼─────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Delete   │ Dynamic imports in                  │ Already statically available. Adds latency and masks errors.   │
  │          │ state/route.ts:54-56                │                                                                │
  ├──────────┼─────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Delete   │ Post-commit session re-read in      │ The updated sections are already available from the            │
  │          │ editProjectSection:346-353          │ transaction. Pass them through instead of re-querying.         │
  ├──────────┼─────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │          │ Section editor page state           │ The two independent debounce paths with cross-dependencies     │
  │ Rewrite  │ management                          │ create a guaranteed stale-closure bug. Consolidate into a      │
  │          │                                     │ useAutoSave hook with a ref.                                   │
  ├──────────┼─────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Rewrite  │ All bare db queries in workspace.ts │ Must use withUserRLS. This is the single most important fix.   │
  ├──────────┼─────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Rewrite  │ Test suite                          │ Current mocks prove nothing. Either test pure functions or use │
  │          │                                     │  a real database.                                              │
  ├──────────┼─────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Simplify │ SectionStateBadge                   │ Use useTranslations instead of a parallel locale prop system.  │
  ├──────────┼─────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Simplify │ UUID_RE duplication                 │ Extract to @/lib/validators/uuid.ts, import everywhere.        │
  └──────────┴─────────────────────────────────────┴────────────────────────────────────────────────────────────────┘
