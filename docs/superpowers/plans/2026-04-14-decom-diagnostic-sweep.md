# `/api/ai/diagnostic` Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide and execute the fate of `app/src/app/api/ai/diagnostic/route.ts` as a single rubric-carrying PR. Per spec Section 2, this route is classified as an independent operational endpoint — its evidence is its own, not piggy-backed on the orchestrator retirement track.

**Architecture:** One PR. Per `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md` Track C: route has zero frontend refs, zero test refs, but is still advertised in `middleware.ts` `publicPaths`. Decision rule: if the route is operational-only (curl / Cloud Monitoring / manual debug), it stays with an explicit rationale documented in a retention entry; otherwise it's deleted with `middleware.ts` cleanup in the same PR.

**Tech Stack:** bash + ripgrep + `next build` + `tsc` + `vitest` + `git`.

**Spec reference:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Sections 2 (Independent operational endpoints), 3 (seven-check rubric).
**Input contract:** `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md` Track C; `probe-04-api-route-orphan.md`; `probe-11-public-surface.md`.

---

## File structure

**Files this plan deletes (if decision is "delete"):**
- `app/src/app/api/ai/diagnostic/route.ts`

**Files this plan modifies (both decisions):**
- `app/src/middleware.ts` — remove `/api/ai/diagnostic` from `publicPaths` array (unconditional — even if the route is retained, it should not be publicly reachable unless the retention rationale explicitly requires it).

**Files this plan may modify (if decision is "retain"):**
- `docs/superpowers/legacy-retention-register.md` — add a retention entry under "Temporary retention entries" or a new "Operational-only retention" section.

**Files this plan creates:**
- `docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/rubric-evidence.md` — full 7-check evidence.
- `docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/operational-usage-check.md` — the evidence for the "delete vs retain" decision.

**Worktree:** Fresh worktree at `/home/godja/Dev/EU-Funds-decom-diagnostic` on branch `chore/decom-diagnostic-sweep` off current master.

---

## Task 0: Set up execution worktree

**Files:** new branch + worktree.

- [ ] **Step 1: Fetch latest master**

Run:
```bash
cd /home/godja/Dev/EU-Funds && git fetch origin master
```
Expected: fetch completes. Master contains the three merged PRs #21/#22/#23.

- [ ] **Step 2: Create worktree**

Run:
```bash
git -C /home/godja/Dev/EU-Funds worktree add -b chore/decom-diagnostic-sweep /home/godja/Dev/EU-Funds-decom-diagnostic origin/master
```
Expected: `Preparing worktree (new branch 'chore/decom-diagnostic-sweep')`.

- [ ] **Step 3: Verify clean state**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && git status && git log --oneline -3
```
Expected: clean working tree, HEAD at current master (commit `adea270` or newer).

- [ ] **Step 4: Create artifact directory**

Run:
```bash
mkdir -p /home/godja/Dev/EU-Funds-decom-diagnostic/docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep
```

---

## Task 1: Read the route to understand what it does

**Files:** Read `app/src/app/api/ai/diagnostic/route.ts`.

- [ ] **Step 1: Read the route file**

Run:
```bash
cat /home/godja/Dev/EU-Funds-decom-diagnostic/app/src/app/api/ai/diagnostic/route.ts
```
Expected: prints the route handler implementation. Per the bootstrap probe output, this is an ops/diagnostic endpoint for DB, Redis, gateway, and `aiGenerate`. Do NOT modify anything; just read.

- [ ] **Step 2: Read the middleware publicPaths to confirm inclusion**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && rg -n "publicPaths|/api/ai/diagnostic" app/src/middleware.ts
```
Expected: shows the `publicPaths` array declaration and the `/api/ai/diagnostic` entry. Record the exact line numbers.

---

## Task 2: Operational-usage check — the decision evidence

**Files:** Create `docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/operational-usage-check.md`.

- [ ] **Step 1: Sweep for any non-frontend usage**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && {
  echo "## A. String references to /api/ai/diagnostic anywhere"
  rg -n "/api/ai/diagnostic" --type-add 'cfg:*.{yaml,yml,json,toml,sh,tf}' -tcfg -t md -t ts -t tsx -t js . 2>/dev/null || echo "(none)"
  echo
  echo "## B. Dockerfile / cloudbuild / deploy manifests referencing the route"
  rg -n "/api/ai/diagnostic" Dockerfile app/Dockerfile cloudbuild*.yaml app/cloudbuild*.yaml .github/ 2>/dev/null || echo "(none)"
  echo
  echo "## C. Health-check / probe configurations that might call it"
  rg -n "health|probe|ready|diagnostic|livez|readyz" app/cloudbuild.production.yaml cloudbuild.production.yaml 2>/dev/null | head -30 || echo "(none)"
  echo
  echo "## D. Documentation referencing it"
  rg -n "/api/ai/diagnostic" docs/ README.md CLAUDE.md app/CLAUDE.md 2>/dev/null || echo "(none)"
} > /tmp/diagnostic-usage.txt
cat /tmp/diagnostic-usage.txt
```
Expected: a list of every place the route is referenced, or `(none)` per section.

- [ ] **Step 2: Write the operational-usage artifact**

Create `/home/godja/Dev/EU-Funds-decom-diagnostic/docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/operational-usage-check.md`:

```markdown
# `/api/ai/diagnostic` — Operational Usage Check

**Date:** 2026-04-14
**Plan:** `docs/superpowers/plans/2026-04-14-decom-diagnostic-sweep.md`
**Purpose:** Establish whether the route has operational users (deploy probes, monitoring, documented ops runbook) before deciding delete vs retain.

## Commands

\`\`\`bash
rg -n "/api/ai/diagnostic" <extensive file-type and path list from Step 1>
\`\`\`

## Raw output

\`\`\`
<paste /tmp/diagnostic-usage.txt verbatim>
\`\`\`

## Decision

<one of:>

### "DELETE" — evidence

- No deploy/health-check manifest references the route.
- No documentation references it as an ops endpoint.
- Frontend refs: 0 (per probe 04).
- Test refs: 0 (per probe 04).
- Conclusion: route is an orphan; delete with middleware cleanup.

### "RETAIN with retention entry" — evidence

- <specific usage found — deploy probe, monitoring agent, documented runbook step>
- <why deletion would break ops>
- Action: keep the route; still remove from middleware `publicPaths` unless the retention rationale explicitly requires public reachability (operational endpoints should typically be behind auth or a signed cron header).
- A retention entry is appended to `docs/superpowers/legacy-retention-register.md` under a new "Operational-only retention" section.
```

- [ ] **Step 3: Fill in the decision section**

Based on the raw output from Step 1 Step 1, pick ONE of the two evidence branches and delete the other. Make the decision explicit — no ambiguity.

- [ ] **Step 4: Commit the operational usage check**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && git add docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/operational-usage-check.md && git -c commit.gpgsign=false commit -m "chore(decom): diagnostic route operational-usage check

Evidence for the delete-vs-retain decision in Plan 5."
```

---

## Task 3: Branch on Task 2's decision

**If Task 2 concluded "DELETE":** proceed to Tasks 4a, 5, 6, 7, 8.
**If Task 2 concluded "RETAIN with retention entry":** skip Task 4a, do Task 4b instead, then Tasks 5, 6, 7, 8 (scoped appropriately).

Both branches still remove `/api/ai/diagnostic` from `publicPaths` in Task 5 unless the retention rationale explicitly calls for public reachability; document the retention rationale inline if so.

---

## Task 4a: Delete the diagnostic route (DELETE branch)

**Files:** Delete `app/src/app/api/ai/diagnostic/route.ts`.

- [ ] **Step 1: Delete the file**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && git rm app/src/app/api/ai/diagnostic/route.ts
```
Expected: `rm 'app/src/app/api/ai/diagnostic/route.ts'`.

- [ ] **Step 2: Verify directory is now empty and remove it if so**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && ls app/src/app/api/ai/diagnostic/ 2>/dev/null || echo "(directory removed)"
```
Expected: `(directory removed)` (git removes empty directories on deletion of the only file).

- [ ] **Step 3: Commit the deletion**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && git -c commit.gpgsign=false commit -m "feat(decom): delete /api/ai/diagnostic route

0 frontend refs, 0 test refs, no ops dependencies found
(see docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/operational-usage-check.md).

Per plan 2026-04-14-decom-diagnostic-sweep.md."
```

---

## Task 4b: Retention entry (RETAIN branch)

**Files:** Modify `docs/superpowers/legacy-retention-register.md`.

- [ ] **Step 1: Read the current register**

Run:
```bash
cat /home/godja/Dev/EU-Funds-decom-diagnostic/docs/superpowers/legacy-retention-register.md
```
Expected: prints the register with the three seed entries (V1 dark-glass, V3 runtime, orchestrator-owned types).

- [ ] **Step 2: Append an "Operational-only retention" section**

Edit `/home/godja/Dev/EU-Funds-decom-diagnostic/docs/superpowers/legacy-retention-register.md`, appending below the existing sections:

```markdown
---

## Operational-only retention

Surfaces kept because deploy/ops infrastructure consumes them, not because a product workstream is replacing them. These entries require the same revalidation discipline as other categories.

### `/api/ai/diagnostic` endpoint

- **surface:** `app/src/app/api/ai/diagnostic/route.ts`
- **axis:** capability (operational)
- **category:** operational-retention
- **blocking_workstream:** none — retained because <fill with exact ops consumer, e.g., "Cloud Monitoring uptime check at <URL>" or "manual ops runbook step in <docs/path>">
- **replacement_spec:** not applicable (no product-side replacement planned)
- **conversion_trigger:** the cited ops consumer is retired or replaced; at that point this entry converts to a delete candidate and Plan 5 reopens
- **last_verified:** 2026-04-14
```

- [ ] **Step 3: Commit the retention entry**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && git add docs/superpowers/legacy-retention-register.md && git -c commit.gpgsign=false commit -m "chore(decom): add /api/ai/diagnostic retention entry

Operational-only retention; no product-side replacement planned."
```

---

## Task 5: Middleware cleanup — remove `/api/ai/diagnostic` from `publicPaths`

**Files:** Modify `app/src/middleware.ts`.

Runs regardless of Task 2's decision branch, UNLESS the retention rationale in Task 4b explicitly requires public reachability. If so, document the exception inline in the middleware with a comment citing the retention entry, and skip the edit.

- [ ] **Step 1: Locate the `publicPaths` entry**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && rg -n "/api/ai/diagnostic" app/src/middleware.ts
```
Expected: at least one line showing the entry, with line number. Record it.

- [ ] **Step 2: Read the surrounding context**

Open `app/src/middleware.ts` and read ~10 lines around the located line to understand the `publicPaths` array shape (string array, path prefix match, etc.).

- [ ] **Step 3: Remove the entry**

Edit the file to remove the `/api/ai/diagnostic` line from the `publicPaths` array. Remove only that one entry — do not touch other entries.

Example edit (actual text depends on file):
- Before: `const publicPaths = [ ..., '/api/ai/diagnostic', ... ];`
- After: `const publicPaths = [ ..., ... ];` (with the entry removed).

- [ ] **Step 4: Verify the edit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && rg -n "/api/ai/diagnostic" app/src/middleware.ts
```
Expected: no matches (empty output). If matches remain, edit again.

- [ ] **Step 5: Commit the middleware change**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && git add app/src/middleware.ts && git -c commit.gpgsign=false commit -m "fix(middleware): remove /api/ai/diagnostic from publicPaths

Route is deleted (or retained as operational-only per retention register).
Either way, publicPaths should not advertise it unless explicitly justified."
```

---

## Task 6: Build and verification (rubric item 3)

**Files:** none modified — verification only.

- [ ] **Step 1: Install dependencies if not already present**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic/app && test -d node_modules || npm ci
```
Expected: either `node_modules` exists already or `npm ci` completes.

- [ ] **Step 2: Run `next build`**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic/app && npm run build 2>&1 | tee /tmp/diagnostic-build.log | tail -40
```
Expected: build completes successfully. If it fails, inspect log and fix; the most likely failure is a type import from the deleted route, but none were found in probe 04 sweeps so this should be clean.

- [ ] **Step 3: Run typecheck**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic/app && npm run typecheck 2>&1 | tee /tmp/diagnostic-typecheck.log | tail -20
```
Expected: zero errors.

- [ ] **Step 4: Run unit tests**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic/app && npm run test 2>&1 | tee /tmp/diagnostic-test.log | tail -30
```
Expected: same pass/fail count as master baseline. Per MEMORY.md "Known Pre-existing Test Failures," some tests fail pre-existingly; new failures must be triaged.

- [ ] **Step 5: Commit verification log summary into rubric-evidence.md (created in Task 7)**

Step runs together with Task 7 Step 2.

---

## Task 7: Write and commit rubric evidence

**Files:** Create `docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/rubric-evidence.md`.

- [ ] **Step 1: Write the rubric-evidence file**

Create `/home/godja/Dev/EU-Funds-decom-diagnostic/docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/rubric-evidence.md`:

```markdown
# `/api/ai/diagnostic` Sweep — Rubric Evidence

**Plan:** `docs/superpowers/plans/2026-04-14-decom-diagnostic-sweep.md`
**Spec:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 3.
**Date:** 2026-04-14
**Branch:** `chore/decom-diagnostic-sweep`
**Decision:** <DELETE / RETAIN — copy from operational-usage-check.md>

## 1. Runtime ownership declaration

<If DELETE:> Route is removed; no replacement. The capability (DB/Redis/gateway ping) is covered by existing `/api/health` and `/api/ready` routes per MEMORY.md infrastructure notes. If a specific diagnostic probe is needed in the future, it is re-added with a named consumer.

<If RETAIN:> Route is retained under operational-only retention. Retention entry at `docs/superpowers/legacy-retention-register.md`. Replacement target: n/a — no product-side replacement.

## 2. Reference sweep

See `docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/operational-usage-check.md`. Also cross-reference:

- `probe-04-api-route-orphan.md`: 0 frontend refs, 0 test refs.
- `probe-11-public-surface.md`: listed in `middleware.ts` `publicPaths`.

## 3. Build and route-surface verification

- `next build`: <PASS / FAIL with notes>
- `tsc --noEmit`: <PASS / FAIL>
- `npm run test`: <pass count> passed, <fail count> failed (vs master baseline)
- `/api/ai/diagnostic` is no longer in `middleware.ts` `publicPaths` (or is, with documented retention exception).

## 4. Feature flag / env var sweep

No flags or env vars were found scoped exclusively to the diagnostic route (probe 07, probe 08). No cleanup needed.

## 5. Test-surface cleanup

Probe 04 reported 0 test references. Confirmed no tests import or exercise this route. No cleanup needed.

## 6. Migration diff

<If DELETE:> No behavioural migration; the capability was already orphaned. Health/ready endpoints cover the ops use case if needed.

<If RETAIN:> No migration; retention is documented in the register.

## 7. Observability sweep

<Only applies to DELETE branch:> No dedicated logs, metrics, Sentry tags, or audit-log event types were found scoped to this route (grep of `app/src/lib/errors/`, `lib/monitoring/`, `logAudit(` calls). Negative result documented.
```

- [ ] **Step 2: Fill in results and decision branches**

Replace the `<DELETE / RETAIN>` and `<PASS / FAIL>` placeholders with the concrete results from Tasks 2 and 6. Delete the inapplicable decision branch (keep only DELETE or only RETAIN text throughout).

- [ ] **Step 3: Verify no unfilled placeholders**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && grep -c "<If\|<PASS\|<DELETE /" docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/rubric-evidence.md
```
Expected: `0`.

- [ ] **Step 4: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && git add docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/rubric-evidence.md && git -c commit.gpgsign=false commit -m "chore(decom): diagnostic sweep rubric evidence

All 7 checks documented."
```

---

## Task 8: Push and open PR

**Files:** none modified.

- [ ] **Step 1: Push branch**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && git push -u origin chore/decom-diagnostic-sweep
```

- [ ] **Step 2: Open PR**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-diagnostic && gh pr create --title "feat(decom): /api/ai/diagnostic sweep" --body "$(cat <<'EOF'
## Summary

Resolves `app/src/app/api/ai/diagnostic/route.ts` under spec Section 2's "independent operational endpoint" classification. Track C of the bootstrap artifacts (`docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md`).

**Decision:** <DELETE / RETAIN — fill from rubric-evidence.md>

**Middleware cleanup:** `/api/ai/diagnostic` removed from `publicPaths` regardless of retain/delete, unless retention rationale explicitly requires public reachability.

## Rubric evidence

`docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/rubric-evidence.md`

## Test plan

- [ ] CI passes under current gating policy
- [ ] \`next build\` succeeds locally
- [ ] Manual: GET \`/api/ai/diagnostic\` <returns 404 on delete branch / returns 200 behind auth on retain branch>

## Plan reference

`docs/superpowers/plans/2026-04-14-decom-diagnostic-sweep.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI under the current gating policy, merge on green**

CI should pass trivially (one deleted route, one middleware edit, docs additions). If any job fails, diagnose from the log.

---

## Self-review checklist

- [ ] Route handled (deleted or retained-with-entry) per Task 2's evidence-based decision.
- [ ] `middleware.ts` no longer advertises `/api/ai/diagnostic` (unless retention explicitly requires it — documented in the PR).
- [ ] `next build`, `tsc`, `npm test` pass.
- [ ] Rubric evidence file has all 7 sections populated, no placeholders.
- [ ] No file outside `app/src/app/api/ai/diagnostic/`, `app/src/middleware.ts`, `docs/superpowers/decom-artifacts/2026-04-14-diagnostic-sweep/`, or the retention register was modified.
- [ ] PR description cites rubric-evidence.md path.
