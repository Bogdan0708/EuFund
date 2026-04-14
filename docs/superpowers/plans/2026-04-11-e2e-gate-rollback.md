# E2E Gate Rollback — Implementation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the blocked PR stack (#11 → #12 → #13) to master, preceded by a CI gate policy addendum to `CLAUDE.md`.

**Architecture:** Phase 0 pre-flight checks (completed 2026-04-14) revealed that the repo is on GitHub Free (private), which does not support branch protection rules. There are **zero enforceable required status checks** on master. The original blocker was not the red `e2e` CI job — it was that all three stack PRs are **drafts**, which GitHub does not allow merging regardless of check status. Therefore the ci.yml `continue-on-error: true` change (originally planned as "Change 1") is unnecessary and has been dropped. The plan reduces to: land a small CLAUDE.md policy PR, mark drafts ready, rebase-cascade, merge.

**Tech Stack:** Git (rebase, force-with-lease), GitHub CLI (`gh pr`).

**Companion spec:** `docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md`

---

## Key findings from Phase 0 (completed)

| Check | Outcome |
|-------|---------|
| Task 0.1: Is `e2e` a required status check? | **NO.** Repo is GitHub Free (private) — branch protection is not available. All `gh api` protection endpoints return 403. `isRequired` is `null` for every check. No checks are enforceable on master at this tier. |
| Task 0.2: Phase 3a integration coverage? | **PASS.** All 8 mutation functions (`saveSectionDraft`, `approveSection`, `rollbackSection`, `rejectSection`, `markSectionStale`, `setSelectedCall`, `freezeOutline`, `setApplicationStatus`) have direct integration test coverage across 4 dedicated Phase 3a test files. |
| Task 0.3: 650e42a timeout discrepancy? | **Resolved.** Master shows `timeout-minutes: 10`. Commit `650e42a` (10→20 bump) lives only on `feature/mcp-tool-extraction` — never merged to master. Will arrive naturally when PR #11 merges. |
| Task 0.4: Stack touches CLAUDE.md? | **PASS.** Zero commits in `master..fix/agent-v3-mutation-guards` touch `CLAUDE.md`. No conflict risk. |

**Original blocker diagnosis:** The stack PRs were not blocked by the red `e2e` status check. They were blocked because all three are **drafts**. On GitHub Free (private), there are no required checks to satisfy — any non-draft PR can be merged regardless of CI state. The entire ci.yml rollback (Task 1A in the original plan) was designed around a premise that turned out to be false.

---

## Scope guardrails

**Will be modified:**
- `CLAUDE.md` (repo root) — append a new section "CI gate policy"

**Will NOT be modified (hard out-of-scope):**
- `.github/workflows/ci.yml` — no ci.yml change needed (no enforceable required checks exist)
- `app/e2e/**` — no test file changes
- `app/playwright.config.ts` — no Playwright config changes
- Any Phase 3a service-layer code under `app/src/lib/` or `app/src/app/api/`
- Any V3 agent mutation guard code

**Cascade invariant:** if any rebase during Phase 2 produces a non-trivial conflict in app code, **STOP immediately**. The desk-audit sign-offs on PR #12 and #13 are only valid while the Phase 3a / V3 code is unchanged by the cascade. An unexpected conflict means the preconditions no longer hold; re-investigate before proceeding.

---

## Phase 1: Policy PR

### Task 1.1: Create and merge CLAUDE.md policy PR

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
baseline-green commit. Phase 0 investigation on 2026-04-14 revealed
that the repo (GitHub Free, private) has no enforceable branch
protection at all — the original blocker was draft PR status, not
failing required checks. The policy is forward-looking: if the repo
ever upgrades to a tier that supports required checks, the rule
prevents premature gate promotion.

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

Recurrence prevention for a prior incident where the Playwright `e2e` job was added to CI on 2026-04-01 (commit c0be113) without a baseline-green commit. Phase 0 investigation (2026-04-14) revealed:

1. The repo is on GitHub Free (private), which does not support branch protection rules
2. There are zero enforceable required status checks on `master`
3. The stack PRs (#11, #12, #13) were blocked because they are **drafts**, not because of failing checks
4. No `ci.yml` change is needed — the `e2e` job failure was always cosmetic on this repo tier

The policy is forward-looking: if the repo upgrades to a tier supporting required checks, this rule prevents premature gate promotion without a demonstrated green baseline.

## Spec

Full design rationale: `docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Record the PR number as `<policy-pr>`.

- [ ] **Step 7: Wait for CI (informational — no checks are required)**

Run: `gh pr checks <policy-pr> --watch`

On this repo tier, no checks are required for merge. CI is informational only. Wait for `quality` and `build-and-test` to complete as a courtesy check, but do not block on `e2e` or any other job. If `quality` or `build-and-test` fail, investigate — CLAUDE.md changes should not break either.

- [ ] **Step 8: Merge the PR**

Run: `gh pr merge <policy-pr> --squash --delete-branch`

Expected: merge succeeds. If it fails because the PR is in draft state, mark it ready first: `gh pr ready <policy-pr>`, then retry the merge.

---

## Phase 2: Stack cascade

Execute in order. Do not parallelize. Each PR must land before the next is rebased.

**Important**: all three stack PRs are currently **drafts**. Each must be marked "Ready for review" before it can be merged. The `gh pr ready` command does this.

### Task 2.1: Rebase and merge PR #11

**Files:** none modified locally — this is a git operation on `feature/mcp-tool-extraction`.

- [ ] **Step 1: Pull the new master**

Run:
```bash
git fetch origin
git checkout master
git pull --ff-only origin master
```

Expected: master now contains the policy PR merge commit from Task 1.1.

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
- In `CLAUDE.md`: expected and acceptable — resolve by keeping both master's new "CI gate policy" section and the stack's existing content.
- In any app code (`app/src/**`, `app/tests/**`): **STOP**. This violates the cascade invariant. Abort the rebase with `git rebase --abort` and escalate to the user.

- [ ] **Step 4: Force-push with lease**

Run:
```bash
git push --force-with-lease origin feature/mcp-tool-extraction
```

`--force-with-lease` (not `--force`) ensures you do not overwrite commits you haven't seen yet. If it fails with "stale info", someone else has pushed to the branch — fetch and re-assess before retrying.

- [ ] **Step 5: Mark PR #11 as ready for review**

Run: `gh pr ready 11`

This is required because draft PRs cannot be merged on GitHub. This step converts the PR from draft to open/ready state.

- [ ] **Step 6: Wait for CI (informational)**

Run: `gh pr checks 11 --watch`

No checks are required for merge on this repo tier. Wait for `quality` and `build-and-test` as a courtesy. `e2e` may be red — that is expected and does not block merge.

- [ ] **Step 7: Merge PR #11**

Run: `gh pr merge 11 --squash --delete-branch`

Expected: merge succeeds. PR #11 closes. The branch `feature/mcp-tool-extraction` is deleted on remote.

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

- [ ] **Step 5: Retarget PR #12's base to master**

PR #12's base was `feature/mcp-tool-extraction`, which no longer exists after Task 2.1 deleted the branch on merge. GitHub may have auto-retargeted it to master, but verify explicitly.

Run:
```bash
gh pr view 12 --json baseRefName -q '.baseRefName'
```

Expected output: `master`. If not, run:

```bash
gh pr edit 12 --base master
```

- [ ] **Step 6: Mark PR #12 as ready for review**

Run: `gh pr ready 12`

- [ ] **Step 7: Wait for CI (informational)**

Run: `gh pr checks 12 --watch`

Same as Task 2.1 Step 6 — informational only.

- [ ] **Step 8: Merge PR #12**

Run: `gh pr merge 12 --squash --delete-branch`

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

**If conflicts appear in CLAUDE.md**: expected — the policy PR added a section on master that this branch doesn't have yet. Resolve by keeping both master's "CI gate policy" section and the stack's existing content.

- [ ] **Step 4: Force-push with lease**

Run:
```bash
git push --force-with-lease origin fix/agent-v3-mutation-guards
```

- [ ] **Step 5: Retarget PR #13's base to master**

Run:
```bash
gh pr view 13 --json baseRefName -q '.baseRefName'
```

Expected: `master`. If not:

```bash
gh pr edit 13 --base master
```

- [ ] **Step 6: Mark PR #13 as ready for review**

Run: `gh pr ready 13`

- [ ] **Step 7: Wait for CI (informational)**

Run: `gh pr checks 13 --watch`

- [ ] **Step 8: Merge PR #13**

Run: `gh pr merge 13 --squash --delete-branch`

---

## Phase 3: Follow-up

### Task 3.1: Open stabilization tracking issue

**Files:** none

- [ ] **Step 1: Create the tracking issue**

Run:
```bash
gh issue create --title "Establish baseline-green e2e on master, then re-require as status check" --body "$(cat <<'EOF'
## Context

Follow-up to the April 2026 e2e-gate rollback (spec: \`docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md\`).

The Playwright \`e2e\` job was added to CI on 2026-04-01 (commit c0be113) without a baseline-green run on master. Investigation on 2026-04-14 revealed that the repo (GitHub Free, private) has no enforceable branch protection — there are zero required status checks. The original merge blocker was **draft PR status**, not the red \`e2e\` check.

No \`ci.yml\` change was needed to unblock the PR stack. However, the e2e suite itself remains ~90% red and needs stabilization before it can provide meaningful signal.

## Goal

Establish a baseline-green e2e suite on master, then (if the repo upgrades to a tier supporting branch protection) promote \`e2e\` to a required check.

## Acceptance criteria

- [ ] A single commit on master where the full Playwright e2e suite (or a deliberately chosen and justified subset) runs green in CI
- [ ] The green CI run's artifact is preserved as the baseline oracle — link or archive the artifact for posterity
- [ ] If branch protection becomes available (GitHub Pro/Team upgrade), \`e2e\` is added as a required status check at that time

## Explicit non-goals

- This issue does NOT scope how to make the suite green (rewrite vs. subset vs. full refresh). That decision belongs to whoever picks up the work, informed by the state of the repo at that time — particularly the state of the legacy-surface decommissioning workstream.
- This issue does NOT block the Managed Agents migration or any other feature work.

## Dependencies

Recommend picking this up after the legacy-surface decommissioning workstream has defined the current target generation (V2 Stitch frontend, Managed Agents runtime). Stabilizing e2e against a retiring surface is wasted work.

## References

- Spec: \`docs/superpowers/specs/2026-04-11-e2e-gate-rollback-design.md\`
- Plan: \`docs/superpowers/plans/2026-04-11-e2e-gate-rollback.md\`
- CLAUDE.md policy addendum: committed via policy PR (Phase 1)
- Phase 0 findings: repo is GitHub Free (private), no branch protection available
EOF
)"
```

Expected: issue is created and URL is printed. Record the issue number.

---

## Success verification

After all phases complete, verify:

- [ ] PRs #11, #12, #13 are merged to master in order
- [ ] `git log --oneline master -5` shows the squash-merge commits for all three in sequence
- [ ] `grep 'CI gate policy' CLAUDE.md` returns the new section (from the policy PR)
- [ ] The stabilization tracking issue exists and is open
- [ ] No file under `app/e2e/`, `app/playwright.config.ts`, `.github/workflows/ci.yml`, or any Phase 3a / V3 source code was modified by anything in this plan

If any of these fail, investigate before declaring the work done.
