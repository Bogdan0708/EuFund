 BrutalCode Agent 1 Review

  Scope Reviewed

  Frontend pages, layouts, components, hooks, state management, forms, navigation, loading/error/empty states, editor
  UX, data contracts, accessibility.

  Files/Areas Inspected

  - Hooks (5): useOrchestrator.ts (532L), useAgent.ts (283L), useCSRF.ts, useCommandPalette.ts, useSidebar.ts
  - Pages (10): panou, proiecte, proiecte/[id], proiecte/[id]/sectiuni/[sectionId], proiecte/nou, documente,
  asistent-ai, setari, autentificare, bun-venit
  - Components (~80 files): layout/, agent/, workspace/, landing/, editor/, ui/, calls/, files/, projects/, settings/,
  forms/
  - Dashboard layout, AppShell, Sidebar, TopNav, CommandPalette, NotificationsPanel, CookieConsent

  Critical Issues

  C1. Dual orchestration hooks — dead code or split-brain risk

  File: hooks/useOrchestrator.ts + hooks/useAgent.ts
  What: Two completely separate hooks manage AI conversation state. useOrchestrator uses EventSource (SSE), useAgent
  uses fetch streaming with ReadableStream. Both define their own message types, status types, and state shape. The
  asistent-ai page uses useOrchestrator; the agent/ components use useAgent.
  Why it matters: Any fix or feature (reconnect logic, CSRF handling, message dedup) must be applied in two places. If
  both exist in production, a dev will wire the wrong one. The Agent V3 memory says useAgent replaces useOrchestrator —
  but the main page still uses the old one.
  User-facing failure: If someone wires useAgent to the main page without removing useOrchestrator, sessions will break.
   Currently the agent components (AgentWorkspace, AgentConversation) are orphaned — no page renders them.
  Fix: Delete useOrchestrator and the entire components/agent/ + components/workspace/ directories if Agent V3 is the
  path forward. If V2 orchestrator is still live, delete useAgent and agent components. One hook, one truth.

  C2. proiecte/[id]/page.tsx fetches project data 3 times on mount

  File: app/[locale]/(dashboard)/proiecte/[id]/page.tsx:462-513
  What: Three independent useEffects each call fetch(/api/v1/projects/${id}) — once for project details (line 464), once
   for submission docs (line 492), once for files (line 481, separate endpoint but triggered by project). The submission
   docs effect re-fetches the entire project response just to read metadata.submissionDocuments.
  Why it matters: 3 waterfall requests for data that should be 1 call. On slow connections this creates visible loading
  jank with partial data. Race condition: the three effects can complete in any order, and the submission docs effect
  reads stale project from closure.
  User-facing failure: Slow page load, potential flicker. The project dependency in the files/submission effects means
  they re-fire on every project state change too.
  Fix: Single useEffect that fetches project + files in parallel (via Promise.all), extracts submission docs from the
  same project response. No cascading effects.

  C3. asistent-ai resume button missing locale prefix

  File: app/[locale]/(dashboard)/proiecte/[id]/page.tsx:585
  What: router.push(/asistent-ai?session=${aiSessionId}) — missing /${locale} prefix. Also line 593.
  Why it matters: Navigates to /asistent-ai?session=... which hits the catch-all 404 or the wrong locale route.
  User-facing failure: "Resume AI" button on project detail page navigates to 404.
  Fix: Add /${locale} prefix to both push calls.

  High Severity Issues

  H1. handleSSEEvent in useOrchestrator has stale closure over all setters

  File: hooks/useOrchestrator.ts:152
  What: handleSSEEvent is wrapped in useCallback([], []) with an empty dependency array. It captures setMessages,
  setCurrentStep, etc. — which are stable from React, so this works. BUT flushChunkBuffer (line 346) is a plain function
   that's recreated every render and is NOT captured by the callback. It accesses refs directly so it happens to work,
  but the eslint-disable comment hides the fact that this is fragile.
  Why it matters: If anyone refactors flushChunkBuffer to use state instead of refs, the stale closure will silently
  break streaming.
  Fix: Move flushChunkBuffer inside handleSSEEvent or convert to a ref-based callback.

  H2. No CSRF on section editor auto-save

  File: app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx:67
  What: The save() function uses bare fetch() with PATCH method. No CSRF token is sent. Other mutation endpoints
  (orchestrator, preferences, consent) all use csrfFetch.
  Why it matters: CSRF protection is enforced in middleware. This endpoint may silently fail or be vulnerable depending
  on how middleware handles PATCH without the token.
  User-facing failure: Auto-save silently fails. User thinks they saved, navigates away, loses work.
  Fix: Use csrfFetch from @/lib/csrf/client.

  H3. No CSRF on submission-documents PATCH

  File: app/[locale]/(dashboard)/proiecte/[id]/page.tsx:318-333,369-385
  What: The "Mark Complete" and "Mark Incomplete" buttons in DocumentsTabContent use bare fetch() for PATCH requests
  without CSRF token.
  Fix: Use csrfFetch.

  H4. useOrchestrator.connectSSE creates EventSource without auth

  File: hooks/useOrchestrator.ts:108
  What: new EventSource(url) cannot send custom headers. If the SSE endpoint requires auth or CSRF, EventSource has no
  mechanism to provide them. Authentication must rely solely on session cookies.
  Why it matters: If the server-side SSE endpoint checks headers beyond cookies, it will reject the connection silently.
   The onerror handler will trigger exponential backoff, burning 5 reconnect attempts before showing an error.
  Fix: Document that the SSE endpoint MUST use cookie-only auth. Consider switching to fetch-based streaming (like
  useAgent does) for header support.

  H5. Dashboard hardcoded funding match data

  File: app/[locale]/(dashboard)/panou/page.tsx:346-377
  What: "Top Funding Matches" sidebar contains hardcoded English strings: "Digital Transformation Grant 2024",
  "Eco-Innovation Seed Fund", "€200,000", "€50,000", "15 Nov", "2 Dec". Only the descriptions use i18n.
  Why it matters: Romanian users see English grant titles. Amounts and dates are static lies.
  User-facing failure: Users see fake funding data that never changes. Damages trust.
  Fix: Either wire to real API data or remove the section entirely.

  H6. Command palette has hardcoded fake "Recent Projects"

  File: components/layout/CommandPalette.tsx:47-48
  What: "Recent Project 1" and "Recent Project 2" are hardcoded i18n keys that always show the same fake entries. They
  navigate to the generic /proiecte page, not actual projects.
  User-facing failure: Users see fake "recent projects" that don't correspond to anything.
  Fix: Fetch actual recent projects or remove the section.

  Medium Severity Issues

  M1. useCSRF hook is dead code

  File: hooks/useCSRF.ts
  What: This hook fetches the CSRF token from /api/health headers. But no component imports it — everyone uses csrfFetch
   + bootstrapCSRFToken from @/lib/csrf/client.
  Fix: Delete hooks/useCSRF.ts.

  M2. MDXEditor renders with key={value} implicitly — content changes cause full remount

  File: components/editor/section-editor.tsx:69
  What: MDXEditor receives markdown={value} but MDXEditor is a controlled component that initializes from markdown only
  on mount. If value changes externally (e.g., after conflict resolution), the editor won't update.
  User-facing failure: After a 409 conflict, the user sees stale content in the editor until they refresh.
  Fix: Pass a key prop to force remount on conflict, or use MDXEditor's imperative setMarkdown API.

  M3. Notification panel uses hardcoded i18n keys for notification content

  File: components/layout/NotificationsPanel.tsx:140-146
  What: t(notification.titleKey) assumes the key exists in the translations file. If the backend sends dynamic
  notification keys that aren't in the i18n files, it renders the raw key string.
  Fix: Provide fallback text or validate keys exist.

  M4. Agent components use hardcoded English strings

  File: components/agent/AgentWorkspace.tsx:25-30, 99-100, AgentConversation.tsx:49,69
  What: Phase labels ("Discovery", "Research", etc.), placeholder text ("Thinking...", "Describe your project..."), and
  "Send" button are all hardcoded English.
  Fix: If these components are active, use i18n. If orphaned (see C1), delete them.

  M5. Projects list page doesn't update URL for pagination

  File: app/[locale]/(dashboard)/proiecte/page.tsx:160
  What: const [page] = useState(1) — page is initialized to 1 and never changes. No pagination UI exists. The API is
  called with perPage=12 but there's no way to access page 2+.
  User-facing failure: Users with >12 projects can't see them all.
  Fix: Add pagination controls or infinite scroll.

  M6. Search debounce in projects page leaks timeout on unmount

  File: app/[locale]/(dashboard)/proiecte/page.tsx:162-167
  What: searchTimeoutRef is never cleared on unmount. If the component unmounts during the 300ms window, it calls
  setSearch on an unmounted component.
  Fix: Add cleanup in useEffect or use a proper debounce hook.

  M7. Settings page params destructuring uses async params pattern incorrectly

  File: app/[locale]/(dashboard)/setari/page.tsx:97
  What: params: _params — the params are accepted but never used. The locale is never read from params, so if the page
  needs locale-specific behavior beyond i18n, it will break.
  Fix: Minor — just remove unused param or use it.

  M8. proiecte/[id] page files and submissionDocs effects depend on project but should depend on id

  File: app/[locale]/(dashboard)/proiecte/[id]/page.tsx:480-513
  What: Both effects have project in deps, meaning they re-fetch whenever setProject(...) triggers a re-render. The
  project dep is used as a guard (if (!project) return), but this creates a dependency cycle: fetch project -> set
  project -> trigger file/doc fetches.
  Fix: Remove project from deps, use a loaded boolean or chain fetches properly.

  Low Severity Issues

  L1. panou/page.tsx:207 typo: novo instead of nou

  File: app/[locale]/(dashboard)/panou/page.tsx:207
  What: router.push(/${locale}/proiecte/novo) — should be /proiecte/nou (the actual route).
  User-facing failure: "New Project" quick-start card navigates to 404.
  Severity escalation: This is actually a user-facing bug — bumping to High.

  L2. progressPercent in dashboard is a rough estimate

  File: app/[locale]/(dashboard)/panou/page.tsx:26-33
  What: Maps DB status to hardcoded percentages (ciorna=20, in_lucru=60, deschis=100). This is a lie — "in progress"
  doesn't mean 60% done.
  Fix: Use complianceScore or section completion percentage instead.

  L3. Sidebar role is hardcoded "Premium Curator"

  File: components/layout/Sidebar.tsx:95
  What: Every user sees "Premium Curator" regardless of their actual tier.
  Fix: Pass user tier and display it.

  L4. LiveBackground renders on every dashboard page

  File: components/layout/AppShell.tsx:28
  What: An animated background canvas runs on every page including the editor and AI assistant. This burns GPU cycles.
  Fix: Add a prop or context to disable it on performance-sensitive pages.

  Hidden Structural Problems

  1. Two parallel UI systems coexist: The components/agent/ directory (gray/blue Tailwind, hardcoded English) and the
  asistent-ai/components/ directory (Material Design tokens, i18n) implement the same concepts with completely different
   designs. This is tech debt from the V2→V3 agent transition that was never cleaned up.
  2. No shared fetch/mutation pattern: Some pages use csrfFetch, some use bare fetch. Some handle errors, some silently
  swallow them. There's no shared hook for authenticated API calls with proper error handling, loading states, and CSRF.
  3. The "documents" page (documente) and the project "sections" tab overlap: Both display the same sections data from
  /api/v1/projects/${id}/sections. The documents page is a workspace-level view; the sections tab is a project-level
  view. They share no code and have subtly different UX (one links to the editor, the other shows inline markdown
  preview).
  4. No client-side route guards beyond the server layout: The dashboard layout does server-side auth redirect. But
  client-side navigation between pages has no guard. If the session expires mid-use, all API calls fail silently or
  return 401s that aren't handled consistently.

  Most Suspicious Components/Hooks

  1. useOrchestrator — 532 lines, 7 refs, SSE + HTTP + auto-approve timeout + chunk buffering + reconnect backoff in one
   hook. Too many responsibilities.
  2. ProposalTab.tsx — 580 lines in a page-level component file. Contains SectionHistoryPanel, SectionActionButtons,
  SectionProgressHeader, and ProposalTabContent — 4 components that should be separate files.
  3. proiecte/[id]/page.tsx — ~700+ lines. Contains DocumentsTabContent (240 lines), LargeProgressRing, TabTrigger,
  SkeletonBlock, PageSkeleton, and the page itself. God file.
  4. CommandPalette — hardcoded items, no real search, fake recent projects.
  5. cookie-consent.tsx — custom i18n object instead of using the app's next-intl system.

  Refactor Recommendations

  1. Kill orphaned agent/workspace components — Delete components/agent/, components/workspace/, and
  hooks/useOrchestrator.ts OR hooks/useAgent.ts. Pick one. Memory says Agent V3 is the path forward.
  2. Extract project detail into proper tab components — proiecte/[id]/page.tsx should delegate each tab to its own file
   (like SectionsTabContent already does). DocumentsTabContent should be components/DocumentsTabContent.tsx.
  3. Create useAuthenticatedFetch hook — Wraps csrfFetch with: CSRF bootstrap, loading state, error handling, 401
  detection + redirect, retry. Kill all bare fetch() for mutations.
  4. Consolidate section views — The documente page and SectionsTabContent should share a <SectionList> component.
  5. Replace ProposalTab.tsx internals with separate files — SectionHistoryPanel, SectionActionButtons,
  SectionProgressHeader should each be standalone files.

  Quick Wins

  ┌─────┬──────────────────────────────────┬──────────────────────────────────────┬────────┐
  │  #  │               File               │                 Fix                  │ Effort │
  ├─────┼──────────────────────────────────┼──────────────────────────────────────┼────────┤
  │ 1   │ panou/page.tsx:207               │ Fix novo → nou typo (404 bug)        │ 1 min  │
  ├─────┼──────────────────────────────────┼──────────────────────────────────────┼────────┤
  │ 2   │ proiecte/[id]/page.tsx:585,593   │ Add /${locale} prefix to AI nav      │ 1 min  │
  ├─────┼──────────────────────────────────┼──────────────────────────────────────┼────────┤
  │ 3   │ hooks/useCSRF.ts                 │ Delete dead file                     │ 1 min  │
  ├─────┼──────────────────────────────────┼──────────────────────────────────────┼────────┤
  │ 4   │ sectiuni/[sectionId]/page.tsx:67 │ Replace fetch with csrfFetch         │ 5 min  │
  ├─────┼──────────────────────────────────┼──────────────────────────────────────┼────────┤
  │ 5   │ proiecte/[id]/page.tsx:318,369   │ Replace fetch with csrfFetch         │ 5 min  │
  ├─────┼──────────────────────────────────┼──────────────────────────────────────┼────────┤
  │ 6   │ Sidebar.tsx:95                   │ Show actual user tier                │ 5 min  │
  ├─────┼──────────────────────────────────┼──────────────────────────────────────┼────────┤
  │ 7   │ proiecte/[id]/page.tsx:462-513   │ Consolidate 3 project fetches into 1 │ 15 min │
  └─────┴──────────────────────────────────┴──────────────────────────────────────┴────────┘

  What I Would Rewrite First

  proiecte/[id]/page.tsx — It's the highest-traffic page after dashboard, it has 3 redundant fetches, a missing locale
  prefix (404 bug), no CSRF on mutations, and a 700+ line god-file structure. Extract tab content, fix the data loading,
   add CSRF. This alone fixes 3 Critical/High issues and makes the project detail page reliable.