# PR #4 Rubric Evidence — `/api/ai/generate-proposal` retirement

Date: 2026-04-14
Plan: `docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md` (PR #4)
Spec: `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` (Sections 1, 3)

## Section 1 — Runtime ownership / replacement capability

**Retired capability**: one-shot AI proposal generation with RAG-sourced context + post-hoc fact-checking annotation of generated content.

**Inheritor**: V3 Agent section-drafting MCP write-tool surface (spec Section 3). The V3 runtime produces proposals section-by-section through the state machine (`discovery → research → structuring → drafting → review`), with each phase gated by policy matrix preconditions (`saveSectionDraft`, `approveSection`, etc.) and audit-chained mutations via the service layer. This replaces the monolithic one-shot endpoint with phased, versioned, rollback-capable section authoring.

**Evidence of no in-product caller**: Frontend uses `useAgent` / `useOrchestrator` hooks. No page, server component, or client hook imports `/api/ai/generate-proposal`. Grep confirms only e2e spec + test fixtures + retiring route reference it.

## Section 2 — Scope discipline

- Only the retiring route, its two dedicated helpers, 4 test files (3 surgical + 1 fixture migration), orphan schema pair, 1 barrel line, and 2 CLAUDE.md narrative edits were touched.
- `eu-knowledge-base.ts` deliberately **not** deleted (deferred to final cleanup PR per plan).
- `sanitize.ts`, `client.ts`, `rag/pipeline`, `utils/romanian`, `logger` — all keepers with many consumers, untouched.
- e2e specs, CI workflows, MEMORY.md, agent-harness, plan, spec — untouched.

## Section 3 — Barrel hygiene

- `app/src/lib/ai/index.ts:7` (`generateProposal`, `proposalInputSchema`, `ProposalInput`, `ProposalOutput`) — barrel line removed.
- Zero barrel consumers across `app/src` / `app/tests` / `app/scripts` confirmed by grep before deletion.
- `eu-knowledge-base` barrel re-export at line 16 intentionally left intact (out of scope).

## Section 4 — Orphan schema cleanup

- `generateProposalSchema` and `GenerateProposalInput` deleted in-PR (not deferred).
- Pre-deletion consumer set: retired route + removed security.test.ts block.
- Post-deletion grep: zero hits.

## Section 5 — Test classification (heaviest section)

| File | Before `it()` count | After `it()` count | Delta | Method |
|------|---------------------|--------------------|-------|--------|
| `tier-gating.test.ts` | 3 | 1 | -2 | Surgical remove |
| `critical-flows.test.ts` | 4 | 3 | -1 | Surgical remove |
| `security.test.ts` Input Validation | 5 | 2 | -3 | Surgical remove |
| `ai-feature-rate-limit.test.ts` | 3 | 3 | 0 | URL-fixture migration |

### Migration rationale for `ai-feature-rate-limit.test.ts`
The three tests exercise `withAIAuth` middleware directly — the retired URL was a cosmetic `NextRequest` fixture, not a real routed import. No middleware unit tests exist under `app/tests/unit/`, so deleting would lose coverage. Single `sed` replaced `/api/ai/generate-proposal` → `/api/ai/chat` (chosen over `/api/ai/match-grants` because the latter retires in PR #5). `feature: 'proposal'` retained — it is a middleware `AIFeature` type constant, not a route URL, and tests rate-limit-by-feature-key behavior. All 3 tests pass post-migration.

### Post-PR test suite health
- Total: 1005 passed / 15 skipped / 2 todo / 0 failed (5.16s).
- Zero new failures introduced; zero pre-existing failures flipped green or red.

## Section 6 — Verification (evidence before assertions)

```
$ rg -n "proposal-generator|fact-checker" app/src/lib/ai/index.ts
(zero)
$ rg -n "/api/ai/generate-proposal" app/src app/tests
(zero)
$ rg -n "generateProposalSchema|GenerateProposalInput" app/src app/tests app/scripts
(zero)
$ rg -n "proposal-generator|fact-checker" app/src app/tests
(zero)
$ npm run typecheck
(clean)
$ npm run build
(success)
$ npm run test
1005 passed / 15 skipped / 2 todo / 0 failed
```

## Section 7 — Audit resourceType uniqueness

`resourceType: 'proposal'` appears **only** in the retired route (`generate-proposal/route.ts:51`). Other resource types like `'call_for_proposal'` in `admin/calls/route.ts` are unrelated (different domain). No audit table migration required — historical audit entries remain valid but the action will no longer be emitted.

```
$ rg -n "resourceType.*'proposal'" app/src
app/src/app/api/ai/generate-proposal/route.ts:51:        resourceType: 'proposal',  (DELETED)
```

No collision with surviving resource types. Post-PR grep returns zero.

## Section 8 — Projection to follow-on work

After this PR:
- `eu-knowledge-base.ts` direct-path consumers = 0. Barrel re-export still active. Cleanup scheduled for the final orphan-AI cleanup PR.
- `ai-feature-rate-limit.test.ts` now uses `/api/ai/chat` as fixture. If PR #X retires `/api/ai/chat`, a follow-up URL migration will be needed — document this in that PR's reference sweep.
