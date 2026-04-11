# E2E Gate Rollback — Unblock PR #11 / #12 / #13 Stack

**Date**: 2026-04-11
**Author**: Bogdan (with Claude Opus 4.6)
**Status**: Draft — awaiting user review before plan handoff

## Thesis

Because the repository lacks a verified green baseline for the Playwright e2e suite, current e2e failures cannot be used to attribute regressions to the stacked PRs #11 / #12 / #13. Therefore the required e2e gate should be de-required, the unrelated stack merged under the repository's previously functioning CI policy, and e2e stabilization handled as a separate, explicitly scoped effort.

**The stack is not requesting an exception. It is requesting the de-requirement of a never-baselined gate that predates it.**

## Background

### The stack

Three stacked draft PRs, agreed merge order #11 → #12 → #13, with rebase + force-push cascade between each:

| PR | Head | Base | Scope |
|----|------|------|-------|
| #11 | `feature/mcp-tool-extraction` | `master` | Phase 1 (MCP tool extraction) + Phase 2 (Managed Agents read-only pilot) |
| #12 | `feature/phase3a-service-hardening` | `feature/mcp-tool-extraction` | Phase 3a service-layer hardening (desk-audit signed off) |
| #13 | `fix/agent-v3-mutation-guards` | `feature/phase3a-service-hardening` | V3 mutation guards follow-up (desk-audit signed off) |

### The observed block

PR #11 CI is red on the `e2e` job:
- 109 Playwright tests, approximately 90% failure rate on CI
- Failures concentrated on core dashboard routes: `/ro/panou`, `/ro/asistent-ai`, `/ro/documente`
- A prior attempt to increase tolerance by bumping the job timeout from 10 to 20 minutes did not help — the failures are genuinely red, not timed out
- A prior lint-fix commit (`5e636b4`) cleared a separate pre-existing `quality` job blocker, but did not address `e2e`

### Investigation that reframed the problem

The initial hypothesis was "UI redesign drifted the tests out of sync with current routes/selectors." Investigation showed the situation is more fundamental:

1. **Master has no known green run with e2e enabled.** The last successful CI run on master (`22677202254`, 2026-03-04) predates the existence of the `e2e` job entirely. The job was added later on master via commit `c0be113` on 2026-04-01, authored by the current user, without a commit of record demonstrating the suite green.
2. **The stack did not introduce or modify the suite.** `git log master..fix/agent-v3-mutation-guards -- app/e2e/ .github/workflows/ci.yml app/playwright.config.ts` returns nothing. The stack does not touch the e2e surface at all.
3. **The e2e job is not a workflow-level dependency of anything else.** In `.github/workflows/ci.yml`, the `e2e` job declares `needs: quality` only; `build-and-test` depends on `[quality, security-gates, admin-storage-gates]`, not `e2e`. The only channel through which `e2e` can gate merge is GitHub branch protection listing it as a required status check in repo settings.

### Load-bearing claim

**Classifying 109 failures against a suite that has never been demonstrated green is unverifiable as merge-blocking evidence.** Without a baseline-green commit to compare against, there is no oracle for distinguishing:

- bad tests from day one
- tests invalidated by subsequent UI drift
- environment, fixture, or setup defects
- actual product regressions introduced by the stack

Diagnostic work may still be operationally useful for later stabilization, but it cannot be a sound prerequisite for deciding whether this stack may merge. The refinement stands: classification is **unverifiable for attribution**, useful for stabilization.

## Decision

De-require the e2e gate. Merge the stack. Stabilize e2e as a separate workstream with its own acceptance criterion.

Approaches considered and rejected:

- **Full-suite refresh first.** Open-ended, no clean acceptance criterion without an oracle, and risks fixture or route edits that conflict with the Phase 3a / V3 code and invalidate the desk-audit sign-offs on #12 and #13.
- **Smoke-set carve-out.** A convenient subset is not a justified subset. Picking the tests that happen to pass today produces a gate that looks green without measuring anything specific; may be revisited later as part of stabilization, but is not the right unblock move now.
- **Failure classification first.** Unverifiable for attribution per the load-bearing claim above.

## Hard prerequisite — do this before any code change

**Verify that the `e2e` job actually blocks PR #11 merge.**

Because `e2e` is not in any other CI job's `needs:` chain, the only way it can block merge is via GitHub branch protection listing it as a required status check. Branch protection cannot be queried via `gh api` on this repo tier, so verification is a manual UI check:

1. Open PR #11 in the GitHub web UI
2. Observe the merge button state
3. If the merge button is enabled despite the red `e2e` status, **`e2e` is not a required check**. The design collapses to "rebase and merge the stack." No ci.yml change is needed. Skip directly to the cascade.
4. If the merge button is disabled with a "required checks failing" or equivalent message, `e2e` is a required check and the rollback changes below apply.

The rest of this document assumes `e2e` is required. If the prerequisite check shows otherwise, close this design without merging the ci.yml change and proceed directly to the cascade section.

## Change 1 — ci.yml rollback (conditional on prerequisite)

Single-line change to `.github/workflows/ci.yml` on the `e2e` job:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: quality
    continue-on-error: true      # added
    timeout-minutes: 10
```

**What this claim means, narrowly**: `continue-on-error: true` prevents the `e2e` job from failing the workflow gate while preserving execution of all steps and upload of Playwright artifacts on failure. The exact UI and status-check semantics (whether the job shows as green, yellow, or red in the PR checks list; whether the check run reports success to branch protection) are a GitHub Actions implementation detail and will be **verified on the rollback PR itself** before relying on them. If the observed semantics do not achieve the required "branch protection sees this as non-blocking" behavior, fall back to one of:

- removing `e2e` from branch protection required checks in repo settings (preferred), or
- moving the `e2e` job to a separate workflow file that is not listed in required checks, or
- deleting the `e2e` job entirely (least preferred — throws away the diagnostic signal).

Explicitly NOT doing in this change:

- Removing, disabling, or skipping the `e2e` job
- Editing `playwright.config.ts`
- Adding `test.skip`, project filters, or any per-spec gating
- Touching any file under `app/e2e/`
- Inventing a smoke subset
- Starting failure classification

## Change 2 — CLAUDE.md policy addendum

Append a short section to `CLAUDE.md`:

> ## CI gate policy
>
> New required CI checks must include a commit of record demonstrating them passing on master before being marked required in branch protection. A red required check is worse than no check — it normalizes override culture and stops protecting anything. This rule is the recurrence prevention for the April 2026 e2e-gate rollback.

This closes the recurrence hole. The April 1 commit adding the `e2e` job was not wrong to add the job; it was wrong to implicitly promote it to required without a green commit on record.

**This change lands regardless of whether Change 1 is needed.** If the hard prerequisite shows `e2e` is already not a required check, Change 2 still lands as a small standalone PR against master before the cascade begins, because the policy is forward-looking recurrence prevention and is valuable independently of the immediate unblock. If Change 1 is needed, Change 2 ships on the same PR so that the policy is reviewable alongside the config change it justifies.

## Change 3 — stack cascade

After the rollback PR lands on master (or immediately, if the prerequisite check shows the rollback is unnecessary):

1. Rebase `feature/mcp-tool-extraction` onto new master → force-push → verify CI → merge PR #11
2. Rebase `feature/phase3a-service-hardening` onto new master (now containing #11) → force-push → verify CI → merge PR #12
3. Rebase `fix/agent-v3-mutation-guards` onto new master (now containing #11 + #12) → force-push → verify CI → merge PR #13

**Merge conflict expectation**: none. The rollback PR touches only `.github/workflows/ci.yml` and `CLAUDE.md`. The stack does not touch either file. Phase 3a / V3 code lives under `app/src/` and `app/tests/`, disjoint from the rollback surface.

**Desk-audit preservation invariant**: the desk-audit sign-offs on #12 and #13 stay valid because no Phase 3a or V3 code changes during the cascade. If any rebase produces a non-trivial conflict in app code, that is a signal something unexpected has happened and the cascade stops for re-investigation before merge.

## Follow-up workstream (not this design)

Open a separate tracking issue: **"Establish baseline-green e2e on master, then re-require as status check."**

Acceptance criteria for that workstream (captured here so the follow-up has a clear finish line, not scoped in detail):

- A single commit on master where the full e2e suite (or a deliberately chosen and justified subset) runs green in CI
- The green CI run's artifact is preserved as the baseline oracle
- Only after that commit exists, re-promote `e2e` to required — by removing `continue-on-error: true` from `ci.yml`, or by re-adding the check to branch protection, whichever matches the final Change 1 mechanism

Explicit non-goals of this design:

- Scoping the stabilization work in detail
- Deciding between full-suite refresh and a justified subset
- Starting failure classification

Classification, fixture review, and selector audits belong in the stabilization workstream, not here. They are useful for stabilization even though they are unverifiable for attribution.

## Risks

1. **Hidden coverage gap.** If `app/e2e/*.spec.ts` is the only integration coverage for the dashboard routes that Phase 3a / V3 touches (`/ro/panou`, `/ro/asistent-ai`, `/ro/documente`), temporarily de-requiring `e2e` leaves a coverage hole during the window between rollback and the stack landing. **Mitigation**: before merging #12, confirm that `app/tests/integration/` contains service-layer tests exercising the Phase 3a mutation paths. The #12 desk audit likely already checked this; worth re-confirming explicitly as part of the cascade.

2. **`650e42a` timeout discrepancy.** Prior notes indicate the `e2e` job `timeout-minutes` was bumped from 10 to 20 on some branch; the file on the stack head currently shows 10. Either the bump was reverted, or the bump lives on a branch that is not in the rollback PR's base. **Mitigation**: confirm before opening the rollback PR so the commit history is not confusing. Not a blocker — the timeout value does not affect the `continue-on-error` mechanism.

3. **`continue-on-error` semantics do not match expectation.** The narrow claim above is that this prevents the job from failing the workflow gate; the wider question of how branch protection treats the resulting check run is to be verified on the rollback PR. If verification shows the gate is still blocking, fall back to one of the alternatives listed under Change 1. **Mitigation**: the rollback PR is itself the verification — if it does not unblock merge, iterate on that same PR rather than opening another.

## Rollout sequence

1. **Prerequisite**: verify whether red `e2e` actually blocks PR #11 merge via the GitHub web UI merge button state.
2. Confirm Phase 3a service-layer integration coverage exists for mutation paths (addresses Risk 1).
3. Resolve the `650e42a` timeout discrepancy — either restore the bump on master or accept that the 10-minute timeout is current (addresses Risk 2).
4. **Branch**: if step 1 showed the `e2e` gate is blocking merge, open the rollback PR against master containing Change 1 (ci.yml one-line addition) and Change 2 (CLAUDE.md policy addendum) together, with a PR description framed explicitly as "de-requiring a never-baselined gate, restoring pre-April-1 effective gating posture" rather than "weakening a functioning safety check." Verify on the PR itself that `continue-on-error` achieves the required behavior (addresses Risk 3); if not, iterate on the same PR with one of the fallback mechanisms. Merge when verified.
5. **Alternate branch**: if step 1 showed the `e2e` gate is not actually blocking merge, open a small standalone PR against master containing only Change 2 (CLAUDE.md policy addendum). Merge when CI passes.
6. Cascade rebase + merge PR #11 → #12 → #13, preserving the desk-audit invariant. Stop immediately on any unexpected conflict.
7. Open the stabilization tracking issue with the acceptance criteria above.

## Success criteria

- PR #11, #12, #13 are merged to master in that order
- No changes made to `app/e2e/`, `app/playwright.config.ts`, or any Phase 3a / V3 code during the unblock
- `CLAUDE.md` contains the CI-gate policy addendum
- A stabilization tracking issue exists with clear acceptance criteria for re-requiring `e2e`
- The desk-audit sign-offs on #12 and #13 remain valid through the cascade

## Out of scope

- Fixing, refactoring, classifying, or deleting any test under `app/e2e/`
- Changing which tests run, in what order, or with what fixtures
- Modifying Phase 3a / V3 code beyond whatever the cascade rebases produce mechanically
- Scoping the stabilization workstream in detail
- Any change to repo settings or branch protection outside of what Change 1 or its fallbacks require
