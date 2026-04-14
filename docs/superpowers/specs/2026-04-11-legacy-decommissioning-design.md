# Legacy Surface Decommissioning — Program Design

**Date**: 2026-04-11
**Author**: Bogdan (with Claude Opus 4.6)
**Status**: Draft — awaiting user review before plan handoff
**Related**: `2026-04-11-e2e-gate-rollback-design.md` (companion, tactical unblock)
**Supersedes**: nothing
**Follow-on**: a later `YYYY-MM-DD-test-pyramid-rebuild-design.md` spec consumes this spec's Section 5 as its input.

## Thesis

The repository carries overlapping generations of product and infrastructure, and new feature work keeps tripping over "pre-existing" failures in surfaces the team has already decided to retire. Stabilizing those surfaces is paying maintenance on code marked for deletion. This program retires them on a disciplined, evidence-first cadence — not by refactor, not by feature flag, not by archive folder, but by proven removal with a named replacement.

The program does **not** build new replacements. It retires legacy once replacement preconditions exist.

## Governance rules

**Rule 1 — This program does not scope replacement work.**
V2 visual completion, Managed Agents Phase 3 scoping, test pyramid rebuild, and any other "build the keeper" workstream are out of scope. This program retires legacy once those workstreams succeed.

**Rule 2 — Early-start carve-outs must be leaf-safe.**
A carve-out can start before the stack cascade (PR #11 → #12 → #13, see companion spec) lands only if:

- it does not touch stack-owned directories (`app/src/lib/ai/agent/*`, `app/src/lib/ai/agent/managed/*`, `app/src/app/api/mcp/*`),
- it does not require edits to shared routing/plumbing files likely to be touched by the stack,
- its reference sweep is run against **both** current `master` and the current stack tip.

## Section 1 — Current architecture declaration

Legacy is not one thing. It has four axes, each with its own retirement clock. The axis-by-axis target declaration below is the source of truth for classification throughout the rest of this spec.

| Axis | Target | Bridge | Delete candidate |
|------|--------|--------|------------------|
| Route naming | `app/[locale]/(dashboard)/*` (Romanian) | — | `app/[locale]/(app)/*` (English), master-only |
| Visual system | V2 Stitch light tokens (`surface-container-*`, `#faf8fe`, `#0071E3`, Sovereign Minimalist) | V1 dark-glass tokens (`g-card`, `glass-panel`, `#06060A`, `liquid-glass`) — retained while V2 implementation is incomplete | — |
| Agent runtime | Managed Agents (Anthropic Agent API + MCP servers) | V3 runtime (`lib/ai/agent/runtime.ts`, tools, policies, transitions, `useAgent`, `/api/ai/agent/*`) — **operational bridge** that currently owns write-path reality until Managed Phase 3 exists | Orchestrator (`lib/ai/orchestrator/*`, `useOrchestrator`, `/api/ai/orchestrator/*`) — retirement cluster blocked on shared-type rehoming |
| Orphaned capability surface | Agent tool set under `lib/ai/agent/tools/*` and MCP tool contracts | — | Generation-zero AI modules at `lib/ai/*.ts` root and `/api/ai/{legacy-routes}/` — **presumptive delete, pending dependency sweep** |

**Claim discipline.** Items labelled "delete candidate" are either proven unused or load-bearing dependents are named and migrated. Items labelled "presumptive delete" are not promoted to delete candidate until the Section 2 reference sweep produces a zero or a named migration. V3 is explicitly classified as an **operational bridge**, not as legacy-eventually — it owns real write traffic under the current architecture.

**Corroborating observation from exploration** (useful for framing, not a deletion claim): master's 12 Playwright `app/e2e/*.spec.ts` files navigate to routes (`/ro/proiecte`, `/ro/panou`, `/ro/asistent`, `/ro/documente/incarca`, `/ro/finantari/live`, `/ro/setari`) that do not exist in master's route tree (`app/[locale]/(app)/{ai,calls,files,projects,settings}`). The suite was not drifted — it was born broken against master. This is useful context for the companion e2e-rollback spec's "never baselined" claim. The present spec does not modify the e2e suite.

## Section 2 — Mechanical legacy inventory

This section has two parts: a **recipe** (durable method for finding legacy surface without manual audit) and **seed candidate lists** (snapshots from exploration on 2026-04-11). Seed lists are not authority — they are starting points that must be re-run against the stack tip before any retirement PR.

### Recipe — probes

Each probe produces a file list that gets classified by the Section 3 rubric. None of these probes alone identifies legacy; they identify *candidates*.

1. **Runtime residue grep.** Search for `orchestrator`, `useOrchestrator`, `client-v2`, and cross-folder imports of `@/lib/ai/orchestrator/*`. Files outside the orchestrator folder that still import from it are migration candidates; files inside the folder with no external import are delete candidates.
2. **Route-tree diff.** Diff `app/[locale]/(app)/*` against `app/[locale]/(dashboard)/*`. Matching pairs → delete candidate on the `(app)/` side. Unmatched `(app)/*` routes → migration candidate or genuine feature deletion, to be declared in the PR.
3. **Hook-callsite sweep.** Enumerate every caller of `useOrchestrator`. Binary outcome: migrated to `useAgent` / still on the bridge. No third category.
4. **API-route orphan probe.** For each `app/api/ai/*` and `app/api/v1/*` route, grep the frontend (`app/src/app/**`, `app/src/components/**`, `app/src/hooks/**`) and tests (`app/tests/**`, `app/e2e/**`) for the route path string. Zero frontend callsites + zero non-route-test references → orphan candidate.
5. **`lib/ai/` root module reference sweep.** For each file at `app/src/lib/ai/*.ts` not inside `agent/` or `orchestrator/`, count external references across `app/src`, `app/tests`, `app/scripts`. Zero → presumptive delete. Non-zero → classify caller first, then callee.
6. **Design-token coexistence grep.** Files matching both V1 tokens (`g-card|glass-panel|#06060A|liquid-glass`) and V2 tokens (`surface-container|#faf8fe|#0071E3`) are bridge-legacy, not delete candidates. They cannot retire until V2 visual completion finishes.
7. **Feature-flag reach.** For every key in `lib/feature-flags/*` and every row in `feature_flags` seed migrations, find its readers. Flags with zero non-test readers are candidates. Flags read only by a retiring surface retire with the surface (rubric item 4).
8. **Env-var reach.** `grep -r` each env var from `.env.example`, `cloudbuild.production.yaml`, `next.config.mjs` across `app/src` and `app/scripts`. Unread env vars are a tell that the feature using them is already dead.
9. **Test-target orphan probe.** Every `app/tests/**` file that imports a module flagged by probes 1–5 inherits its classification. Every `app/e2e/**` spec file that `goto`s a route not in the current route tree is an orphan test.
10. **Re-export / type-dependency probe.** `grep` for `export ... from '@/lib/ai/orchestrator'` and equivalents, type-only imports from legacy surfaces, and shared schema/type modules that keep a runtime alive indirectly. Critical because "folder has no external runtime import" is not sufficient: a legacy surface can still be load-bearing as a type/schema owner (V3 currently imports orchestrator-owned types from `agent/types.ts`, `agent/section-specs.ts`, and multiple tools).
11. **Public-surface probe.** Enumerate `middleware.ts` `publicPaths`, Next.js `rewrites`/`redirects`, `sitemap.ts`, `robots.ts`, nav/menu config under `components/layout/*`, and any localized slug maps. Used both as a discovery probe and as the post-delete route-surface verification under rubric item 3.

### Seed candidate lists (snapshot 2026-04-11 — re-run before action)

Three evidence tiers: **confirmed delete candidate** (rare — only after sweep), **probe target** (most items), **retirement cluster blocked on rehoming**.

**Route layer (Axis 1) — carve-out candidate, Phase 1**

- `app/src/app/[locale]/(app)/` — directory subtree: `ai/`, `calls/`, `files/`, `projects/[id]/`, `projects/page.tsx`, `settings/`, `layout.tsx`, `page.tsx`. Master-only. Rubric item 1 replacement: `(dashboard)/*` arriving with the stack.
- Deletion scope narrowed by leaf-safe audit (Rule 2) against `middleware.ts` `publicPaths`, `i18n.ts` locale config, `components/layout/*` nav, and any component-level `<Link>` or `router.push` referencing `/ro/projects`, `/ro/ai`, `/ro/files`, `/ro/settings`, `/ro/calls`. If the sweep surfaces shared-plumbing edits, those wait until after the stack lands.

**Runtime (Axis 3) — orchestrator retirement cluster, blocked on rehoming**

- Hooks + UI/API callsites: delete/migrate candidates once `asistent-ai/page.tsx` moves from `useOrchestrator` to `useAgent`.
- Orchestrator-owned shared types and helpers (per probe 10): must be rehomed or inlined before the folder can be deleted. Concrete observed importers: `app/src/lib/ai/agent/types.ts`, `app/src/lib/ai/agent/section-specs.ts`, multiple `app/src/lib/ai/agent/tools/*`, `app/src/lib/compliance/form-templates.ts`, `app/src/lib/export/docx.ts`, several `app/src/app/api/v1/projects/*` routes, `app/src/app/api/v1/workspace/route.ts`.
- Full `app/src/lib/ai/orchestrator/` folder deletion is blocked on those migrations, not a standalone candidate.
- `app/src/hooks/useOrchestrator.ts` — delete candidate once its sole known caller (`asistent-ai/page.tsx`) migrates.
- `app/src/lib/ai/client-v2.ts` — **probe target**, not confirmed candidate. Reference sweep required before classification.
- `app/src/app/api/ai/orchestrator/message/route.ts`, `stream/route.ts`, `sessions/[sessionId]/sections/[sectionId]/{rollback,state,versions}/route.ts` — probe targets. The V3 analogues of several of these have already been deleted on the stack under commit `2227abb` ("delete vestigial rollback/state routes under /api/ai/agent"); the orchestrator-side equivalents have not.

**Operational endpoints — independent sweep (not under orchestrator retirement)**

- `app/src/app/api/ai/diagnostic/route.ts` — ops/diagnostic endpoint for DB, Redis, gateway, `aiGenerate`. Does **not** import orchestrator. May still be a delete candidate, but on its own evidence, not as part of orchestrator retirement.

**Orphaned capability surface (Axis 4) — presumptive delete candidates, Phase 2**

Reference sweep required before any delete claim is promoted.

- `app/src/lib/ai/compliance-engine.ts`
- `app/src/lib/ai/compliance-validator.ts`
- `app/src/lib/ai/deadline-intelligence.ts`
- `app/src/lib/ai/document-analyzer.ts`
- `app/src/lib/ai/enhanced-proposal-generator.ts`
- `app/src/lib/ai/eu-ai-act.ts`
- `app/src/lib/ai/eu-knowledge-base.ts`
- `app/src/lib/ai/fact-checker.ts`
- `app/src/lib/ai/grant-matcher.ts`
- `app/src/lib/ai/knowledge-engine.ts`
- `app/src/lib/ai/proposal-generator.ts`
- `app/src/lib/ai/reporting-engine.ts`
- `app/src/lib/ai/risk-assessment.ts`
- `app/src/app/api/ai/check-eligibility/`
- `app/src/app/api/ai/generate-insights/`
- `app/src/app/api/ai/generate-proposal/`
- `app/src/app/api/ai/generate-proposal-enhanced/`
- `app/src/app/api/ai/generate-report/`
- `app/src/app/api/ai/ghid-to-tasks/`
- `app/src/app/api/ai/match-grants/`
- `app/src/app/api/ai/search-calls/`

Each with non-zero frontend references becomes a migration candidate (replaced by Managed tools or V3 tools). Each with zero references is a proven delete candidate.

**Bridge legacy — named for inventory completeness, not execution here**

- V1 dark-glass token usage across files matching probe 6. Retires with V2 visual completion (blocking workstream, separate spec).
- V3 runtime modules: `app/src/lib/ai/agent/runtime.ts`, `app/src/lib/ai/agent/tools/*`, `app/src/lib/ai/agent/policies.ts`, `app/src/lib/ai/agent/transitions.ts`, `app/src/hooks/useAgent.ts`, `app/src/app/api/ai/agent/route.ts`. Operational bridge for write paths. Retires with Managed Phase 3.

## Section 3 — Classification rubric

Every retirement PR presents evidence against all seven checks in its description. The order below is the PR presentation order; interpretively, probes run before ownership can be fully justified, but the PR reads 1→7.

1. **Runtime ownership declaration.** Name the target surface that replaces the deleted one: Managed, V3, or V2 `(dashboard)/` route layer. Deletion without a named replacement is only allowed when the surface is proven unused.
2. **Reference sweep.** Exact grep commands with output counts across `app/src`, `app/tests`, `app/e2e`, `app/scripts`, `app/drizzle`, `docs/`, `next.config.*`, `package.json`, and env-var references. Include the probe 10 re-export / type-dependency sweep. Zero-reference outcome is the deletion warrant.
3. **Build and route-surface verification.** `next build` must succeed after deletion **and** a route-surface check must audit nav items, hardcoded fetch targets, `<Link>` hrefs, `router.push` callsites, sitemap entries, `robots.ts`, middleware `publicPaths`, and localized slug maps for stale references App Router will not flag at build time (probe 11).
4. **Feature flag / env var sweep.** Any flag key or env var only read by the retiring surface is deleted in the same PR — including the `feature_flags` DB row and any `_journal.json`-tracked seed migration.
5. **Test-surface cleanup.** Every test importing the deleted module is either deleted (only testing the retired surface) or migrated to exercise the keeper directly.
6. **Migration diff.** If the surface had callers prior to the sweep, the PR contains their migration to the replacement, verified by typecheck and relevant unit tests — **not** by the Playwright e2e suite.
7. **Observability sweep.** Dedicated logs, metrics, diagnostics endpoints, error classes, Sentry tags, or audit-log event types belonging to the retiring surface are removed or re-pointed in the same PR. No phantom operational surface after the code is gone.

**Why not feature flags or archive folders.** A gated-retirement flag (`legacy_foo_enabled`) normalizes permanent flags. A `_archive/` or `deprecated/` folder normalizes permanent dead code in the build. Both are observed failure modes in which legacy never actually gets deleted. The discipline lives in the evidence rubric above; there is no transitional scaffolding to hide behind.

## Section 4 — Retirement sequence

### Post-cascade addendum (2026-04-14)

The PR #11 → #12 → #13 stack landed on master on 2026-04-14 (per the companion e2e-rollback spec). PR numbers shifted during the cascade due to a branch-point error and subsequent revert: the final landing PRs are #11 (MCP extraction + Managed Phase 2), #18 (Phase 3a hardening, replacing closed #12), and #19 (V3 mutation guards, replacing closed #13). The CI gate policy addendum landed as PR #17.

Consequences for this section:

- **Phase 0** is closed. The stack protection window no longer applies. Decommissioning work may now touch any surface, subject to the Section 3 rubric.
- **Phase 1** is moot. The `(app)/` English route layer carve-out was designed to start before the cascade landed, under the Rule 2 dual-branch sweep guard. With the cascade landed, `(app)/*` deletion folds into Phase 2 as a normal track — no carve-out construct, no dual-branch sweep needed (single sweep against current master suffices), no leaf-safety negotiation against an unmerged stack tip. Rule 2 itself is retained as standing policy for any future early-start carve-out, but has no active subject in this program.
- **Phase 2** is now the active phase. Three tracks (orchestrator retirement, orphaned AI module audit + deletion, independent operational-endpoint sweep) plus the absorbed `(app)/` route deletion run in parallel on separate branches.
- **Phase 3** unchanged. Still blocked on V2 visual completion and Managed Phase 3.

The phase descriptions below stand as the design-time record. The implementation plan derived from this spec adapts to the post-cascade reality without re-litigating the design.

### Phase 0 — Stack protection window

Active until the cascade (PR #11 → #12 → #13) lands on master per the companion e2e-rollback spec.

- No decomposition work may touch `app/src/lib/ai/agent/*`, `app/src/lib/ai/agent/managed/*`, or `app/src/app/api/mcp/*`.
- No decomposition work may touch broader `app/src/lib/ai/*` unless explicitly proven disjoint from the stack (this is a higher bar than Rule 2's leaf-safety bar and is stated explicitly because lib/ai is the stack's primary surface).
- Phase 1 carve-out runs in this window under the Rule 2 guard.

### Phase 1 — Immediate carve-out (leaf-safe only)

> The `(app)/` English route layer is the only early-start candidate, and only for deletions proven leaf-safe by a dual-branch reference sweep and shared-plumbing audit.

Procedure:

1. Branch `chore/decom-app-route-layer` off master.
2. Run Section 2 probes 2, 4, 10, 11 against **both** master and the current stack tip.
3. If any shared-plumbing file (`middleware.ts`, `i18n.ts`, nav config, locale slug maps) shows an edit dependency, narrow the carve-out to leaf pages only; shared-plumbing edits wait for Phase 2.
4. Open a single PR carrying the 7-check rubric evidence. Target: master.
5. Merge when CI passes under the gating policy established by the companion spec's rollout.

Non-goal: migrating any `(app)/*` route to `(dashboard)/*`. The migration is carried by the stack landing; this carve-out only deletes the version that exists on master.

### Phase 2 — Post-cascade parallel fan-out

After the stack has landed on master, run in parallel on separate branches:

- **Orchestrator retirement track.** Sub-ordering: (a) migrate `asistent-ai/page.tsx` from `useOrchestrator` to `useAgent`; (b) rehome orchestrator-owned shared types per probe 10; (c) delete `useOrchestrator` hook; (d) delete `/api/ai/orchestrator/*` routes; (e) delete `lib/ai/orchestrator/` folder; (f) sweep `client-v2.ts` — its classification is a probe target, not yet a delete candidate, so this step may resolve to either deletion or a migration PR. Each sub-step is its own rubric-carrying PR.
- **Orphaned AI module reference audit and deletion.** Probe 5 produces the candidate list. Each confirmed-delete module or route gets its own rubric-carrying PR. Modules with non-zero callers produce migration PRs to Managed or V3 tools instead — those migrations are explicitly scoped under the PR, not under a general "refactor" umbrella.
- **Independent operational-endpoint sweep.** `app/src/app/api/ai/diagnostic/route.ts` is swept on its own evidence (ops/diagnostic usage patterns, not orchestrator dependency). Tracked as a single rubric-carrying PR separate from the two tracks above, so it cannot accidentally ride the orchestrator retirement's argument.

The two main tracks touch disjoint surfaces (`lib/ai/orchestrator/*` vs. `lib/ai/*.ts` root + `/api/ai/{legacy}/`) and can proceed independently. Cross-track coordination is needed only on shared type files if both tracks happen to want to inline the same type — that's handled by whichever PR lands first, the other rebases.

### Phase 3 — Dependency-bound retirements (blocked, not active)

These are named in the spec to close the inventory loop. They are **not workstreams inside this program**.

- **V1 dark-glass retirement.** Blocked on V2 visual completion. Trigger: every file matching probe 6 is off the list. Retention entry maintained per Section 6.
- **V3 runtime retirement.** Blocked on Managed Phase 3 landing and the `agent_v3_enabled` flag cutover holding for one release with the circuit breaker closed. Retention entry maintained per Section 6.

## Section 5 — Test pyramid rebuild (handoff, not execution)

This program does not write new tests. It defines the keeper surface and the handoff constraints that the follow-on `YYYY-MM-DD-test-pyramid-rebuild-design.md` spec consumes.

1. **Keeper declaration.** The post-decom keeper surface is, as module boundaries (not file lists — file lists rot):

   - `app/src/lib/ai/agent/` tools, services, policies, transitions.
   - `app/src/lib/ai/agent/managed/` runtime and MCP server modules.
   - `app/src/app/api/ai/agent/*` routes.
   - `app/src/app/api/mcp/*` routes.
   - `app/[locale]/(dashboard)/*` page shells.
   - The auth + RLS + audit layer: `lib/auth/*`, `lib/db/rls.sql` + `withUserRLS`, `lib/legal/audit.ts` and `audit-integrity.ts`.

2. **Test ordering principle.** Service tests first, then route-level integration, then smoke e2e.

   - **Service tests (Vitest)** exercise runtime modules and tool handlers directly, without HTTP.
   - **Route integration (Vitest + mocks)** hits Next.js route handlers directly. Mock DB with `vi.mock` where needed.
   - **Smoke e2e (Playwright, localhost:3002)** covers a small number of complete user journeys, not per-page assertions. No "test every page exists" tests — that shape produced the broken suite this program is retiring around.

3. **Illustrative seed journeys — subject to product-owner confirmation.** Not a fixed list; anchor points for the follow-on spec to refine:

   1. OAuth sign-in → first project created → onboarding complete.
   2. Upload call guide → agent extracts structure → eligibility check passes.
   3. Outline frozen → generate section → approve → rollback → approve again.
   4. Complete application → export snapshot download.
   5. Paused session resume across browser refresh with state preserved.

4. **Explicit non-goals (of both this section and the follow-on spec).**

   - Rebuilding the old 91-test Playwright suite shape.
   - Testing every route.
   - Retaining the old `app/e2e/*` suite shape or carrying its specs forward by default. The old suite retires with this program or under the follow-on spec — not left unattended. Salvaging one or two files is not ruled out, but is an explicit decision of the follow-on spec, not an inheritance.

5. **CI re-requirement gate.** The test pyramid rebuild produces, as a byproduct, a baseline-green CI commit on master. That commit is the oracle the companion e2e-rollback spec's follow-up workstream is waiting for. This is phrased as a handoff, not as this program's responsibility to deliver.

## Section 6 — Ownership and retention rule

This section defines the **policy**. The live **register** lives outside the spec at `docs/superpowers/legacy-retention-register.md` so normal maintenance does not turn into spec churn. The register is created when the first bridge-legacy entry is written.

### Policy

**Retention justification, not ownership.** Every surface kept under the bridge-legacy classification in Section 1 must have a retention entry in the register. Each entry has the following required fields:

- `surface` — short name and reference (e.g., `V3 runtime`, file glob or module path).
- `axis` — one of: route / visual / runtime / capability (from Section 1).
- `blocking_workstream` — the replacement program this retention is waiting on. If none, the entry is invalid.
- `replacement_spec` — URL or path to the spec scoping the blocking workstream, when one exists. Absence is permitted while the spec has not been written, but must be noted.
- `conversion_trigger` — the concrete, observable event that converts the surface from bridge to delete candidate.
- `last_verified` — ISO date of the last time the entry was reviewed and found still accurate.

**Unowned-code deletion policy.** Any surface surfaced by Section 2 probes that cannot be given a retention entry — no replacement workstream, no migration owner, no concrete conversion trigger — is a delete candidate by default. "We might need this" is not a retention justification. If the surface matters, someone names the workstream. If nobody does, it goes.

**Revalidation rule (60-day presumptive invalidation).** Any retention entry older than 60 days without a `last_verified` update becomes **presumptively invalid** and must be re-justified before the next decommission PR touching that axis lands. This is a social / review-gate mechanism, not an automated state change — no cron, no bot. The presumption is the pressure; the re-justification is the release.

### Seed entries for the register (to be written when the register file is created)

**Bridge-legacy entries** — surfaces retained while a replacement workstream completes.

1. **V1 dark-glass tokens.** Axis: visual. Blocking workstream: V2 visual completion. Replacement spec: none written as of 2026-04-11. Conversion trigger: every file in Section 2 probe 6 is off the list. `last_verified: 2026-04-11`.
2. **V3 runtime.** Axis: runtime. Blocking workstream: Managed Agents Phase 3. Replacement spec: referenced in `docs/superpowers/specs/2026-04-09-managed-agents-architecture.md` Section 5 (Phase 3 not yet scoped in a standalone spec). Conversion trigger: Managed write tools land, `agent_v3_enabled=false` holds for one release with breaker closed. `last_verified: 2026-04-11`.

**Temporary retention entries during active retirement** — blockers internal to a retirement track, not bridge legacy in the Section 1 sense. These exist only while a track is in progress and retire with it.

3. **Orchestrator-owned shared types.** Axis: runtime. Blocking workstream: internal to this program (shared-type rehoming in Phase 2, orchestrator track). Replacement spec: this document. Conversion trigger: last external import of `@/lib/ai/orchestrator/types` removed. `last_verified: 2026-04-11`.

## Section 7 — Success criteria

The program is done when all four are true.

1. **Delete legacy surfaces are gone.** `(app)/*` English route layer, the full orchestrator retirement cluster (after shared-type rehoming), and all confirmed-delete orphaned AI modules and routes are removed from master. **Removal is proven by rerunning the Section 2 probes against master, not by stale PR evidence.**
2. **Bridge surfaces have live retention justifications.** Every V1 dark-glass file matching probe 6 and every V3 runtime module has an entry in the retention register naming its blocking workstream and conversion trigger. No un-justified bridge legacy.
3. **Keeper surface is declared, not just implied.** The Section 5 keeper list matches the post-decom code tree. No module in the keeper list is missing, and no module outside the declared keeper surface exists **within the legacy-program axes** (route naming, visual system, agent runtime, orphaned capability surface) except bridge legacy with live retention entries. Non-program code (billing, auth infrastructure, integrations, etc.) is unaffected by this criterion.
4. **Handoff to test pyramid rebuild is complete.** The follow-on test-pyramid-rebuild spec exists and points back at this spec's Section 5 as its keeper-surface input. The old `app/e2e/*` suite and its broken Romanian-route specs are either deleted with this program or explicitly scoped for deletion by the follow-on spec — not left in the tree unattended.

### Explicit non-criteria

- E2e green in CI — that is the companion e2e-rollback spec's follow-up workstream, not this program's finish line.
- V2 visual completion — Rule 1.
- Managed Phase 3 landing — Rule 1.
- Zero lines of code net — decom can produce a larger tree if keepers need type-rehome files and the register has entries; the goal is coherence, not minimalism.

## Out of scope

- All e2e-suite modifications. Owned by the companion spec and its follow-up.
- Phase 3a / V3 code changes beyond what the Section 2 probes surface as cross-imports from retiring surfaces.
- Any change to repo settings, branch protection, or CI workflow configuration beyond what the companion spec's rollout produces mechanically.
- Scoping or implementation of V2 visual completion, Managed Phase 3, or the test pyramid rebuild.
- MEMORY.md churn. Memory updates are made at session end, not per-PR, and coordination with the companion session's memory writes happens outside this program.

## Relationship to the companion spec

This spec and `2026-04-11-e2e-gate-rollback-design.md` are peers that solve different problems and must not be conflated.

- The e2e-rollback spec is a **tactical unblock** that de-requires a never-baselined CI gate so the PR stack can merge. Its scope ends when the stack has landed.
- This spec is a **strategic retirement program** that removes overlapping generations once the stack has landed. Its scope begins (mostly) after the companion spec's succeeds.

The only overlap is Rule 2's Phase 1 carve-out, which can start before the stack lands. That carve-out is the single point of coordination between the two specs and is explicitly guarded by the dual-branch sweep.
