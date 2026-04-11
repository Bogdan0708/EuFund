# E2E Gate Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-require the never-baselined Playwright e2e gate on master so the blocked PR stack (#11 → #12 → #13) can cascade to merge.

**Architecture:** Single-line `continue-on-error: true` addition to the `e2e` job in `.github/workflows/ci.yml`, plus a short policy addendum to `CLAUDE.md` that prevents recurrence. Both changes land via a rollback PR against master, then the stack is rebased onto new master and merged in order #11 → #12 → #13. The ci.yml change is gated behind a manual prerequisite check: if GitHub branch protection doesn't actually require `e2e`, the ci.yml change is skipped and only the policy addendum ships.

**Tech Stack:** GitHub Actions workflow YAML, Git (rebase, force-with-lease), GitHub CLI (`gh pr`), GitHub web UI (for branch protection semantics that can't be queried via API on this repo tier).

**Companion spec:** `docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md`

---

## Scope guardrails

**Will be modified:**
- `.github/workflows/ci.yml` — add `continue-on-error: true` on the `e2e` job (conditional on prerequisite outcome)
- `CLAUDE.md` (repo root) — append a new section "CI gate policy" (lands regardless of prerequisite outcome)

**Will NOT be modified (hard out-of-scope):**
- `app/e2e/**` — no test file changes
- `app/playwright.config.ts` — no Playwright config changes
- Any Phase 3a service-layer code under `app/src/lib/` or `app/src/app/api/`
- Any V3 agent mutation guard code
- Any non-CI workflow file

**Cascade invariant:** if any rebase during Phase 2 produces a non-trivial conflict in app code, **STOP immediately**. The desk-audit sign-offs on PR #12 and #13 are only valid while the Phase 3a / V3 code is unchanged by the cascade. An unexpected conflict means the preconditions no longer hold; re-investigate before proceeding.

---

## Phase 0: Pre-flight checks

These are manual verification steps. Record the answers before touching any files.

### Task 0.1: Verify whether red `e2e` actually blocks PR #11 merge

**Files:** none

- [ ] **Step 1: Open PR #11 in the GitHub web UI**

Run: `gh pr view 11 --web`

Or navigate manually to PR #11 in the browser.

- [ ] **Step 2: Observe the merge button state**

Look at the merge button at the bottom of the PR page. One of two outcomes:

- **Outcome A**: Merge button is **disabled** with a message like "Required status check 'e2e' is failing" or "Required checks have not succeeded." → `e2e` is a required status check. Change 1 (ci.yml edit) is needed. Proceed with Phase 1, Branch A.
- **Outcome B**: Merge button is **enabled** despite the red `e2e` status (button may show "Squash and merge" or "Merge pull request" as clickable). → `e2e` is not a required status check. Change 1 is unnecessary. Proceed with Phase 1, Branch B.

Record the outcome in a note you will reference in Task 1.0. Do not merge anything yet.

- [ ] **Step 3: Record outcome**

Write down: "Task 0.1 outcome: A" or "Task 0.1 outcome: B".

### Task 0.2: Confirm Phase 3a service-layer integration coverage exists

**Files:**
- Read: `app/tests/integration/`
- Read: PR #12 diff via `gh pr diff 12`

This addresses Risk 1 in the spec (hidden coverage gap). We need to confirm that de-requiring `e2e` does not leave Phase 3a mutation paths unvalidated.

- [ ] **Step 1: List integration test files**

Run: `ls app/tests/integration/ | grep -Ei 'section|proposal|agent|service|mutation|phase3'`

Expected: one or more files matching. If the list is empty, the coverage gap risk is real and must be escalated to the user before proceeding.

- [ ] **Step 2: Inspect PR #12 for the service-layer code it changes**

Run: `gh pr diff 12 --name-only`

Look for service-layer files (under `app/src/lib/` typically). Note the top 5 most significant files — these are the mutation paths you need to verify are tested.

- [ ] **Step 3: Grep integration tests for those service-layer symbols**

For each of the top 5 service-layer files noted in Step 2, pick the primary exported function name and run:

Run: `grep -r "<function name>" app/tests/integration/ --include='*.test.ts' -l`

Expected: at least one test file per function. If any primary function has zero test files referencing it, note it as a coverage gap.

- [ ] **Step 4: Record coverage verdict**

Write down: "Task 0.2 verdict: PASS" (integration coverage exists for all inspected Phase 3a mutation paths), or "Task 0.2 verdict: FAIL — gaps: [list]" (coverage is missing; escalate to user before proceeding to Phase 2).

**If FAIL**: pause here, report the gaps to the user, and ask whether to proceed anyway. The cascade should not continue with a known coverage gap without explicit user acceptance.

### Task 0.3: Resolve the 650e42a timeout discrepancy

**Files:**
- Read: `.github/workflows/ci.yml` at master
- Read: `.github/workflows/ci.yml` at fix/agent-v3-mutation-guards

This addresses Risk 2 in the spec. Prior notes say commit `650e42a` bumped the `e2e` job `timeout-minutes` from 10 to 20, but the current file shows 10. Resolve before opening the rollback PR so the commit history is not confusing.

- [ ] **Step 1: Check master's current timeout value**

Run: `git show master:.github/workflows/ci.yml | grep -A1 'e2e:' | head -10`

Look for `timeout-minutes:` under the `e2e` job. Record the value.

- [ ] **Step 2: Check if commit 650e42a exists and what it touched**

Run: `git show --stat 650e42a 2>&1 | head -20`

Expected: either the commit exists and shows a ci.yml change, or it does not exist on any branch reachable from the local refs. Record whichever is true.

- [ ] **Step 3: Record resolution**

One of the following is true after steps 1-2:

- **Master already shows 20**: no action needed. The memory note was correct, current-working-tree view during brainstorming was on a different branch. Proceed.
- **Master shows 10 and 650e42a exists on a non-merged branch**: the bump never landed on master. Ignore. The rollback PR does not need to re-apply the bump; `continue-on-error` makes the timeout moot. Proceed.
- **Master shows 10 and 650e42a is unknown**: the commit reference was stale. Ignore. Proceed.
- **Any other state**: escalate to the user. Do not guess.

Write down: "Task 0.3 resolution: [which of the above]".

### Task 0.4: Verify stack does not touch CLAUDE.md

**Files:**
- Inspect: `CLAUDE.md` history on stack branches

Already confirmed by the planning author at 2026-04-11 as empty, but re-verify before Phase 2 since the stack may have been force-pushed since.

- [ ] **Step 1: Run git log on the stack range**

Run: `git log --oneline master..fix/agent-v3-mutation-guards -- CLAUDE.md`

Expected: empty output. If non-empty, the stack touches CLAUDE.md and the rollback PR's Change 2 will conflict during cascade. Escalate to user.

- [ ] **Step 2: Record verdict**

Write down: "Task 0.4 verdict: PASS" or "Task 0.4 verdict: FAIL — conflict risk, escalate."

---

## Phase 1: Rollback PR

### Task 1.0: Branch decision

- [ ] **Step 1: Pick branch based on Task 0.1 outcome**

- If Task 0.1 outcome was **A** (`e2e` is required, merge blocked): proceed to **Task 1A**.
- If Task 0.1 outcome was **B** (`e2e` is not required, merge enabled): proceed to **Task 1B**.

Only execute the branch that matches. Do not execute both.

---

### Task 1A: Full rollback PR (ci.yml + CLAUDE.md)

**Execute only if Task 0.1 outcome was A.**

**Files:**
- Modify: `.github/workflows/ci.yml` (add `continue-on-error: true` to `e2e` job)
- Modify: `CLAUDE.md` at repo root (append "CI gate policy" section)
- Create branch: `fix/derequire-e2e-gate`

- [ ] **Step 1: Ensure local master is up to date**

Run:
```bash
git fetch origin
git checkout master
git pull --ff-only origin master
```

Expected: no conflicts, master is at `origin/master`. If any error, stop and investigate.

- [ ] **Step 2: Create the rollback branch**

Run:
```bash
git checkout -b fix/derequire-e2e-gate
```

Expected: branch created, you are now on it.

- [ ] **Step 3: Edit `.github/workflows/ci.yml` to add `continue-on-error: true`**

Find the `e2e` job header. Before the change it looks like:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: quality
    timeout-minutes: 10
```

After the change:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: quality
    continue-on-error: true
    timeout-minutes: 10
```

Only this one line is added. No other changes to the file. If the current file shows `timeout-minutes: 20` instead of 10, that's fine — still add `continue-on-error: true` as the new line before `timeout-minutes`.

- [ ] **Step 4: Verify the ci.yml diff is exactly one line**

Run: `git diff .github/workflows/ci.yml`

Expected: exactly one added line (`+    continue-on-error: true`), zero removed lines. If the diff is larger, revert and redo.

- [ ] **Step 5: Edit `CLAUDE.md` at repo root — append "CI gate policy" section**

Append to the end of `CLAUDE.md` (or immediately before any existing trailing content-free section):

```markdown

## CI gate policy

New required CI checks must include a commit of record demonstrating them passing on master before being marked required in branch protection. A red required check is worse than no check — it normalizes override culture and stops protecting anything. This rule is the recurrence prevention for the April 2026 e2e-gate rollback.
```

- [ ] **Step 6: Verify the CLAUDE.md diff is an append only**

Run: `git diff CLAUDE.md`

Expected: additions only (green lines), zero deletions. If any lines were removed, revert and redo.

- [ ] **Step 7: Commit both changes in a single commit**

Run:
```bash
git add .github/workflows/ci.yml CLAUDE.md
git commit -m "$(cat <<'EOF'
ci: de-require never-baselined e2e gate, add CI gate policy

The Playwright e2e job was added to CI on 2026-04-01 (c0be113) without
a commit of record demonstrating it passing on master. No green baseline
has ever existed for the suite with the gate enabled. Classifying its
current failures as attribution evidence is therefore unverifiable, and
blocking unrelated PRs on it enforces a bar master itself has never met.

This change:

- Adds `continue-on-error: true` to the `e2e` job so it still runs and
  uploads artifacts on failure but does not fail the workflow gate.
- Appends a "CI gate policy" section to CLAUDE.md requiring a green
  commit of record before any new CI check becomes required, as
  recurrence prevention for this incident.

This is restoring the repository to its pre-April-1 effective gating
posture. It is not weakening a functioning safety check — it is
de-requiring one that was never baselined.

Followup tracking issue will cover e2e stabilization: establish a
baseline-green commit on master, then re-promote e2e to required.

See docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md for
the full rationale.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds. If pre-commit hooks fail, fix the issue and create a new commit (do not amend).

- [ ] **Step 8: Push the branch and open the PR**

Run:
```bash
git push -u origin fix/derequire-e2e-gate
gh pr create --base master --title "ci: de-require never-baselined e2e gate" --body "$(cat <<'EOF'
## Summary

- De-requires the Playwright `e2e` CI job by adding `continue-on-error: true`
- Adds a "CI gate policy" section to `CLAUDE.md` as recurrence prevention

## Why this is not weakening CI

The `e2e` job was added to CI on 2026-04-01 (commit c0be113) without a commit of record demonstrating the suite passing on master. There has never been a green baseline for the full suite since the gate was added. That means:

1. The current ~90% failure rate cannot be attributed to any specific PR — there is no oracle commit to compare against.
2. Using the job as a required gate holds every unrelated PR to a bar master itself has never met.
3. A required check that has never been baselined is not a real safety check; it is process debt pretending to be one.

This PR **restores the repository to its pre-April-1 effective gating posture**, which is the gating posture under which every P0 security fix and the browser audit work shipped successfully through March 2026.

## What this does NOT do

- Does not remove, disable, or skip the `e2e` job — it still runs, and its artifacts are still uploaded on failure
- Does not modify `app/e2e/`, `app/playwright.config.ts`, or any application code
- Does not repeal the intent of having e2e coverage. A separate tracking issue will cover stabilization: establish a baseline-green commit on master, then re-promote `e2e` to required by removing `continue-on-error: true`

## Verification plan

After merging, verify on PR #11 that the merge button becomes enabled (indicating `continue-on-error: true` achieves the required branch-protection semantics). If it does not, fall back to one of:

1. Repo-settings change to remove `e2e` from required checks, if available in the operating context
2. Move the `e2e` job to a separate workflow file not listed in required checks
3. Delete the `e2e` job entirely (least preferred — throws away the diagnostic signal)

## Spec

Full design rationale: `docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR is created and its URL is printed. Record the PR number as `<rollback-pr>`.

- [ ] **Step 9: Wait for the rollback PR's CI to complete**

Run: `gh pr checks <rollback-pr> --watch`

Expected: `quality`, `security-gates`, `admin-storage-gates`, `build-and-test`, and `rls-postgres-check` all pass. `e2e` may still fail — that is expected and is exactly what the change is designed to tolerate.

- [ ] **Step 10: Verify the merge button is enabled despite red `e2e`**

Run: `gh pr view <rollback-pr> --web`

Look at the merge button state. Expected: enabled, despite any red `e2e` status.

If the merge button is enabled → `continue-on-error: true` is doing the right thing. Proceed to Step 11.

If the merge button is still disabled → the mechanism failed. Fall back to one of the alternatives listed in the PR description. Iterate on the same branch rather than opening a new PR. Re-run Step 9 and Step 10 after each fallback attempt.

- [ ] **Step 11: Merge the rollback PR**

Run: `gh pr merge <rollback-pr> --squash --delete-branch`

Expected: merge succeeds. Local master does not yet contain the merge commit; that will happen in Task 2.1.

---

### Task 1B: Policy-only PR (CLAUDE.md addendum)

**Execute only if Task 0.1 outcome was B.**

**Files:**
- Modify: `CLAUDE.md` at repo root
- Create branch: `docs/ci-gate-policy`

- [ ] **Step 1: Ensure local master is up to date**

Run:
```bash
git fetch origin
git checkout master
git pull --ff-only origin master
```

- [ ] **Step 2: Create the policy branch**

Run:
```bash
git checkout -b docs/ci-gate-policy
```

- [ ] **Step 3: Append the "CI gate policy" section to `CLAUDE.md`**

Append to the end of `CLAUDE.md`:

```markdown

## CI gate policy

New required CI checks must include a commit of record demonstrating them passing on master before being marked required in branch protection. A red required check is worse than no check — it normalizes override culture and stops protecting anything. This rule is the recurrence prevention for the April 2026 e2e-gate rollback.
```

- [ ] **Step 4: Verify the diff is an append only**

Run: `git diff CLAUDE.md`

Expected: additions only, zero deletions.

- [ ] **Step 5: Commit**

Run:
```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: add CI gate policy to CLAUDE.md

Adds a short "CI gate policy" section requiring a green commit of
record before any new CI check becomes required in branch protection.

This is recurrence prevention for a prior incident where the
Playwright e2e job was added on 2026-04-01 (c0be113) without a
baseline-green commit. Although investigation showed the gate was not
actually listed as required in branch protection, the underlying
rule — no required check without a baseline — is worth making
explicit so the same premature-promotion mistake is not made again.

See docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md for
context.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Push and open the PR**

Run:
```bash
git push -u origin docs/ci-gate-policy
gh pr create --base master --title "docs: add CI gate policy to CLAUDE.md" --body "$(cat <<'EOF'
## Summary

- Adds a "CI gate policy" section to `CLAUDE.md` requiring a green commit of record before any new CI check becomes required in branch protection

## Context

Recurrence prevention for a prior incident where the Playwright `e2e` job was added to CI on 2026-04-01 (commit c0be113) without a baseline-green commit. Investigation showed the gate was not actually required in branch protection, so no `ci.yml` change is needed — but the underlying rule is worth making explicit so the same premature-promotion mistake is not made again.

## Spec

Full design rationale: `docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Record the PR number as `<policy-pr>`.

- [ ] **Step 7: Wait for CI to pass**

Run: `gh pr checks <policy-pr> --watch`

Expected: all required checks pass. `e2e` may still fail (branch protection does not require it); that's fine.

- [ ] **Step 8: Merge the PR**

Run: `gh pr merge <policy-pr> --squash --delete-branch`

---

## Phase 2: Stack cascade

Execute in order. Do not parallelize. Each PR must land before the next is rebased.

### Task 2.1: Update local master and rebase PR #11

**Files:** none modified locally — this is a git operation on `feature/mcp-tool-extraction`.

- [ ] **Step 1: Pull the new master**

Run:
```bash
git fetch origin
git checkout master
git pull --ff-only origin master
```

Expected: master now contains the rollback PR (Task 1A) or policy PR (Task 1B) merge commit.

- [ ] **Step 2: Check out the stack base branch**

Run:
```bash
git checkout feature/mcp-tool-extraction
git pull origin feature/mcp-tool-extraction
```

- [ ] **Step 3: Rebase onto new master**

Run:
```bash
git rebase master
```

Expected: clean rebase, no conflicts. If conflicts appear:
- In `CLAUDE.md` or `.github/workflows/ci.yml`: expected and acceptable — resolve by keeping the master version's additions (the policy section, and `continue-on-error` if Task 1A ran) and the stack's unrelated content
- In any app code (`app/src/**`, `app/tests/**`): **STOP**. This violates the cascade invariant. Abort the rebase with `git rebase --abort` and escalate to the user.

- [ ] **Step 4: Force-push with lease**

Run:
```bash
git push --force-with-lease origin feature/mcp-tool-extraction
```

`--force-with-lease` (not `--force`) ensures you do not overwrite commits you haven't seen yet. If it fails with "stale info", someone else has pushed to the branch — fetch and re-assess before retrying.

- [ ] **Step 5: Wait for PR #11's CI to complete**

Run: `gh pr checks 11 --watch`

Expected: `quality`, `security-gates`, `admin-storage-gates`, `build-and-test` pass. `e2e` may be red but merge button should be enabled after the rollback.

- [ ] **Step 6: Verify the merge button is enabled**

Run: `gh pr view 11 --web`

If enabled → proceed to Step 7. If disabled → the rollback did not achieve its intended effect; re-investigate before merging anything.

- [ ] **Step 7: Merge PR #11**

Run: `gh pr merge 11 --squash --delete-branch`

Expected: merge succeeds. PR #11 closes.

### Task 2.2: Rebase and merge PR #12

- [ ] **Step 1: Pull the new master**

Run:
```bash
git fetch origin
git checkout master
git pull --ff-only origin master
```

Expected: master now contains PR #11's squashed merge commit.

- [ ] **Step 2: Check out PR #12's branch**

Run:
```bash
git checkout feature/phase3a-service-hardening
git pull origin feature/phase3a-service-hardening
```

- [ ] **Step 3: Rebase onto new master**

Run:
```bash
git rebase master
```

Expected: clean rebase. PR #12 was branched from `feature/mcp-tool-extraction`, so now that #11 is squashed into master, the rebase should drop the already-merged commits and replay only #12's unique commits on top of master.

**If conflicts appear in any Phase 3a code (`app/src/lib/`, `app/src/app/api/`, `app/tests/integration/`)**: this means the squash-and-merge of #11 reworked code that #12 also touches. STOP. Abort with `git rebase --abort`. Escalate to the user — the desk-audit sign-off on #12 may need re-verification.

**If conflicts appear in unrelated files (CLAUDE.md, workflows, etc.)**: resolve by taking master's version for policy/config lines, stack's version for feature content.

- [ ] **Step 4: Force-push with lease**

Run:
```bash
git push --force-with-lease origin feature/phase3a-service-hardening
```

- [ ] **Step 5: Change PR #12's base to master**

PR #12's base was `feature/mcp-tool-extraction`, which no longer exists after Task 2.1 deleted the branch on merge. GitHub may have auto-retargeted it to master, but verify explicitly.

Run:
```bash
gh pr view 12 --json baseRefName -q '.baseRefName'
```

Expected output: `master`. If not, run:

```bash
gh pr edit 12 --base master
```

- [ ] **Step 6: Wait for PR #12's CI to complete**

Run: `gh pr checks 12 --watch`

Expected: all required checks pass.

- [ ] **Step 7: Verify merge button is enabled and merge**

Run: `gh pr view 12 --web`

If enabled → `gh pr merge 12 --squash --delete-branch`

If disabled → investigate. Do not force-merge.

### Task 2.3: Rebase and merge PR #13

- [ ] **Step 1: Pull the new master**

Run:
```bash
git fetch origin
git checkout master
git pull --ff-only origin master
```

- [ ] **Step 2: Check out PR #13's branch**

Run:
```bash
git checkout fix/agent-v3-mutation-guards
git pull origin fix/agent-v3-mutation-guards
```

- [ ] **Step 3: Rebase onto new master**

Run:
```bash
git rebase master
```

Expected: clean rebase. PR #13 was stacked on #12; after #12 is squashed into master, the rebase should replay only #13's unique commits (including the spec file `docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md` and this plan file `docs/superpowers/plans/2026-04-11-e2e-gate-rollback.md`, both of which were authored on the #13 branch during planning).

**If conflicts appear in Phase 3a / V3 code**: STOP. Same escalation as Task 2.2 Step 3.

**If conflicts appear in CLAUDE.md**: expected if Task 1A or 1B ran. Resolve by keeping both master's "CI gate policy" section and any unrelated stack content.

- [ ] **Step 4: Force-push with lease**

Run:
```bash
git push --force-with-lease origin fix/agent-v3-mutation-guards
```

- [ ] **Step 5: Change PR #13's base to master**

Run:
```bash
gh pr view 13 --json baseRefName -q '.baseRefName'
```

Expected: `master`. If not:

```bash
gh pr edit 13 --base master
```

- [ ] **Step 6: Wait for PR #13's CI**

Run: `gh pr checks 13 --watch`

- [ ] **Step 7: Verify merge button is enabled and merge**

Run: `gh pr view 13 --web`

If enabled → `gh pr merge 13 --squash --delete-branch`

If disabled → investigate.

---

## Phase 3: Follow-up workstream

### Task 3.1: Open stabilization tracking issue

**Files:** none

- [ ] **Step 1: Create the tracking issue**

Run:
```bash
gh issue create --title "Establish baseline-green e2e on master, then re-require as status check" --body "$(cat <<'EOF'
## Context

Follow-up to the April 2026 e2e-gate rollback (spec: \`docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md\`). The Playwright \`e2e\` job in CI was de-required because it had never had a baseline-green run on master after being added on 2026-04-01 (commit c0be113), and classifying its ~90% failure rate as attribution evidence was unverifiable.

## Goal

Restore \`e2e\` to required-check status, safely this time, by establishing a baseline-green commit on master first.

## Acceptance criteria

- [ ] A single commit on master where the full Playwright e2e suite (or a deliberately chosen and justified subset) runs green in CI
- [ ] The green CI run's artifact is preserved as the baseline oracle — link or archive the artifact for posterity
- [ ] \`e2e\` is re-promoted to required, either by removing \`continue-on-error: true\` from \`.github/workflows/ci.yml\` or by the corresponding repo-settings / branch-protection change (whichever matches the final rollback mechanism)

## Explicit non-goals

- This issue does NOT scope how to make the suite green (rewrite vs. subset vs. full refresh). That decision belongs to whoever picks up the work, informed by the state of the repo at that time — particularly the state of the legacy-surface decommissioning workstream.
- This issue does NOT block the Managed Agents migration or any other feature work.

## Dependencies

Recommend picking this up after the legacy-surface decommissioning workstream has defined the current target generation (V2 Stitch frontend, Managed Agents runtime). Stabilizing e2e against a retiring surface is wasted work.

## References

- Spec: \`docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md\`
- Plan: \`docs/superpowers/plans/2026-04-11-e2e-gate-rollback.md\`
- Rollback commit: (will be the squash merge of the Task 1A or 1B PR)
EOF
)"
```

Expected: issue is created and URL is printed. Record the issue number.

- [ ] **Step 2: Cross-reference the issue in the spec (optional)**

If you want the spec to point at the tracking issue, update `docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md` in a small follow-up PR against master, adding the issue number at the end of the "Follow-up workstream" section. This is optional cleanup and not required for the unblock.

---

## Success verification

After all phases complete, verify:

- [ ] PRs #11, #12, #13 are merged to master in order
- [ ] `git log --oneline master -5` shows the squash-merge commits for all three in sequence
- [ ] `grep 'CI gate policy' CLAUDE.md` returns the new section
- [ ] `grep 'continue-on-error' .github/workflows/ci.yml` returns the line (if Task 1A ran) or returns nothing (if Task 1B ran)
- [ ] The stabilization tracking issue exists and is open
- [ ] No file under `app/e2e/`, `app/playwright.config.ts`, or any Phase 3a / V3 source code was modified by anything in this plan

If any of these fail, investigate before declaring the work done.
