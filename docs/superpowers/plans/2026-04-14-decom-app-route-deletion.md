# `(app)/` English Route Layer Deletion — Implementation Plan

> **Status (2026-04-14): SUPERSEDED BY CASCADE.** The `app/src/app/[locale]/(app)/` subtree was already deleted on master by the PR #11 → #18 → #19 cascade landing before this plan was executed. Task 0 Step 4 of this plan would exit with "directory absent." This file is retained as a design-time record of the work that was planned against pre-cascade master — it documents the rubric shape and the leaf-safety audit pattern that later deletion plans reuse. **Do not execute.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (Not applicable — see Status above.)

**Goal:** Delete the legacy English-named `app/src/app/[locale]/(app)/` route layer (Axis 1 delete legacy per spec Section 1) in a single PR carrying the full Section 3 7-check rubric evidence. Replacement is the Romanian-named `(dashboard)/` route layer that landed with the cascade.

**Architecture:** Single-PR deletion. Targeted reference sweep against `(app)/*` URL paths (single-branch — post-cascade so the dual-branch carve-out construct from spec Section 4 Phase 1 no longer applies; see post-cascade addendum). Leaf-safety audit ensures no shared-plumbing edits are needed; if any are surfaced, the PR scope narrows to leaf pages and the shared-plumbing edits become a follow-up. Build + typecheck + unit tests verify; e2e is not consulted.

**Tech Stack:** bash + ripgrep + `next build` + `tsc` + `vitest` + `git`. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Sections 1, 3, 4 (post-cascade addendum).

**Independence from Plan 1:** This plan runs its own targeted versions of probes 2, 4, 10, 11 scoped to the `(app)/` subtree, so it does not block on Plan 1's broader artifacts. Plan 1 outputs are referenced as supporting context where useful but are not prerequisites.

---

## File structure

**Files this plan deletes:**

- `app/src/app/[locale]/(app)/` — entire subtree, including:
  - `app/src/app/[locale]/(app)/layout.tsx`
  - `app/src/app/[locale]/(app)/page.tsx`
  - `app/src/app/[locale]/(app)/ai/page.tsx`
  - `app/src/app/[locale]/(app)/calls/` (all files)
  - `app/src/app/[locale]/(app)/files/` (all files)
  - `app/src/app/[locale]/(app)/projects/page.tsx`
  - `app/src/app/[locale]/(app)/projects/[id]/` (all files)
  - `app/src/app/[locale]/(app)/settings/` (all files)

**Files this plan may modify (only if the leaf-safety audit surfaces stale references):**

- `app/src/middleware.ts` — `publicPaths` array
- `app/src/lib/i18n.ts` or `app/src/i18n.ts` — locale config
- `app/src/components/layout/Sidebar.tsx`, `MobileNav.tsx`, `TopNav.tsx` — nav config
- `app/src/app/[locale]/layout.tsx` — root layout if it links into `(app)/`
- `app/src/app/sitemap.ts` — sitemap entries
- Any component containing `<Link href="/ro/projects">` or similar legacy URL

If any modification surfaces, decide per Step in Task 4 whether to include in this PR or split.

**Files this plan creates:**

- One PR-evidence artifact at `docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md` documenting the seven checks. Stored as a tracked artifact like Plan 1's probe outputs.

**Worktree:** Execution in a fresh worktree at `/home/godja/Dev/EU-Funds-decom-app-routes` on branch `chore/decom-app-route-deletion` off post-cascade master.

---

## Task 0: Set up execution worktree

**Files:**
- Create: branch `chore/decom-app-route-deletion` off `origin/master`
- Create: worktree at `/home/godja/Dev/EU-Funds-decom-app-routes`

- [ ] **Step 1: Fetch latest master**

Run:
```bash
cd /home/godja/Dev/EU-Funds && git fetch origin master
```
Expected: fetch completes; latest commits include the cascade landing.

- [ ] **Step 2: Create execution worktree**

Run:
```bash
cd /home/godja/Dev/EU-Funds && git worktree add -b chore/decom-app-route-deletion /home/godja/Dev/EU-Funds-decom-app-routes origin/master
```
Expected: `Preparing worktree (new branch 'chore/decom-app-route-deletion')`.

- [ ] **Step 3: Verify clean state**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git status && git log --oneline -3
```
Expected: clean working tree, HEAD at post-cascade master.

- [ ] **Step 4: Verify `(app)/` actually exists on master**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && find "app/src/app/[locale]/(app)" -type d 2>&1
```
Expected: the directory tree is enumerated. If it returns "No such file or directory", the cascade already deleted `(app)/` and this entire plan is a no-op — exit early, document the finding in the artifact, no PR needed.

- [ ] **Step 5: Create artifact directory**

Run:
```bash
mkdir -p /home/godja/Dev/EU-Funds-decom-app-routes/docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion
```
Expected: directory created.

---

## Task 1: Rubric item 1 — Runtime ownership declaration

**Files:**
- Create: `docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md`

- [ ] **Step 1: Write the artifact skeleton with the ownership declaration**

Create `/home/godja/Dev/EU-Funds-decom-app-routes/docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md`:

```markdown
# `(app)/` English Route Layer Deletion — Rubric Evidence

**Plan:** `docs/superpowers/plans/2026-04-14-decom-app-route-deletion.md`
**Spec:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Sections 1, 3, 4.
**Date:** 2026-04-14
**Branch:** `chore/decom-app-route-deletion`

This file documents the seven rubric checks per spec Section 3. Each check has its own H2 section. PR description references this file by path.

## 1. Runtime ownership declaration

The `app/src/app/[locale]/(app)/` route subtree (English-named legacy per spec Section 1, Axis 1) is being deleted. The replacement is the Romanian-named `app/src/app/[locale]/(dashboard)/` route subtree, which landed on master via the PR #11 → #18 → #19 cascade on 2026-04-14.

Mapping (per spec Section 2 probe 2 seed):

- `(app)/ai` → `(dashboard)/asistent-ai`
- `(app)/projects` → `(dashboard)/proiecte`
- `(app)/files` → `(dashboard)/documente`
- `(app)/settings` → `(dashboard)/setari`
- `(app)/calls` → no direct equivalent (capability redirected via funding-call discovery in `(dashboard)/proiecte` and `(dashboard)/asistent-ai`); confirm via probe in Task 2 that `(app)/calls` has zero unique callers before deleting

Replacement axis classification: V2 `(dashboard)/` route layer.

## 2. Reference sweep

(Filled in Task 2.)

## 3. Build and route-surface verification

(Filled in Tasks 4 and 5.)

## 4. Feature flag / env var sweep

(Filled in Task 3.)

## 5. Test-surface cleanup

(Filled in Task 6.)

## 6. Migration diff

(Filled in Task 1 — see below; non-trivial migrations not expected because `(dashboard)/` already exists as the replacement.)

## 7. Observability sweep

(Filled in Task 7.)
```

- [ ] **Step 2: Confirm replacement coverage by listing `(dashboard)/` siblings**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && find "app/src/app/[locale]/(dashboard)" -mindepth 1 -maxdepth 1 -type d | sort
```
Expected: enumerates `asistent-ai`, `documente`, `panou`, `proiecte`, `setari` (and possibly more). Verify each `(app)/` segment has a `(dashboard)/` counterpart per the mapping above. Update the rubric file's Section 1 mapping if the actual `(dashboard)/` tree differs.

- [ ] **Step 3: Commit the skeleton**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git add docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md && git -c commit.gpgsign=false commit -m "chore(decom): start (app)/ deletion rubric evidence — item 1 ownership"
```

---

## Task 2: Rubric item 2 — Reference sweep (targeted to `(app)/` URLs)

**Files:**
- Modify: `docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md`

- [ ] **Step 1: Enumerate the URLs to be retired**

Derive from filesystem layout. Standard URL shape: `/(ro|en)/<segment>/...` where `<segment>` is the top-level directory name inside `(app)/`. For each segment found in Task 0 Step 4, the URLs to sweep are:

```
/ro/ai, /en/ai
/ro/calls, /en/calls
/ro/files, /en/files
/ro/projects, /en/projects, /ro/projects/[id], /en/projects/[id]
/ro/settings, /en/settings
```

(Adjust to match what the actual `(app)/` tree contains.)

- [ ] **Step 2: Run reference sweep across the codebase**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && {
  echo "## A. /ro/* and /en/* URL string references in app/src"
  rg -n "['\"\\\`]/(ro|en)/(ai|calls|files|projects|settings)\\b" app/src/ 2>/dev/null || echo "(none)"
  echo
  echo "## B. URL string references in app/tests"
  rg -n "['\"\\\`]/(ro|en)/(ai|calls|files|projects|settings)\\b" app/tests/ 2>/dev/null || echo "(none)"
  echo
  echo "## C. URL string references in app/e2e (informational — out of scope per Rule 1)"
  rg -n "['\"\\\`]/(ro|en)/(ai|calls|files|projects|settings)\\b" app/e2e/ 2>/dev/null || echo "(none)"
  echo
  echo "## D. URL string references in app/scripts"
  rg -n "['\"\\\`]/(ro|en)/(ai|calls|files|projects|settings)\\b" app/scripts/ 2>/dev/null || echo "(none)"
  echo
  echo "## E. URL string references in docs/"
  rg -n "['\"\\\`]/(ro|en)/(ai|calls|files|projects|settings)\\b" docs/ 2>/dev/null || echo "(none)"
  echo
  echo "## F. Direct file-tree imports referencing the (app)/ subtree"
  rg -n "from ['\"]@/app/\\[locale\\]/\\(app\\)" app/src/ 2>/dev/null || echo "(none)"
} > /tmp/app-routes-refs.txt
cat /tmp/app-routes-refs.txt
```
Expected: file with sections A–F. Most URL refs in section A are actually targeting `(dashboard)/` Romanian routes, which use different segment names (`proiecte`, `documente`, etc.). The above sweep targets only the English segments to avoid false positives; if the regex misses a literal use, manual follow-up.

- [ ] **Step 3: Classify references**

Read `/tmp/app-routes-refs.txt`. For each match:

- If in `app/src/` (sections A, F): a real consumer; this is shared plumbing — Task 4 leaf-safety decision.
- If in `app/tests/` (section B): test file is exercising the `(app)/` route — must be deleted or migrated under rubric item 5 (Task 6).
- If in `app/e2e/` (section C): out of scope per Rule 1; record for the test-pyramid follow-on spec, do not edit here.
- If in `app/scripts/` or `docs/` (sections D, E): not blocking but document.

- [ ] **Step 4: Update rubric-evidence.md Section 2**

Open the artifact file and replace the `(Filled in Task 2.)` placeholder under `## 2. Reference sweep` with:

````markdown
### Commands

```bash
rg -n "['\"\`]/(ro|en)/(ai|calls|files|projects|settings)\b" app/src/ app/tests/ app/e2e/ app/scripts/ docs/
rg -n "from ['\"]@/app/\[locale\]/\(app\)" app/src/
```

### Raw output

```
<paste /tmp/app-routes-refs.txt>
```

### Classification

| Section | Match count | Disposition |
|---------|-------------|-------------|
| A. app/src URL strings | <count> | Edit-in-this-PR if leaf, defer to follow-up if shared plumbing — see Task 4 |
| B. app/tests URL strings | <count> | Migrate or delete under rubric item 5 |
| C. app/e2e URL strings | <count> | Out of scope (Rule 1) — record for test-pyramid follow-on |
| D. app/scripts URL strings | <count> | Document; edit if trivial |
| E. docs URL strings | <count> | Document; edit if trivial |
| F. Filesystem imports | <count> | Must be edited or deletion fails the build (rubric item 3) |
````

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git add docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md && git -c commit.gpgsign=false commit -m "chore(decom): rubric item 2 — (app)/ reference sweep"
```

---

## Task 3: Rubric item 4 — Feature flag / env var sweep

**Files:**
- Modify: `docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md`

- [ ] **Step 1: Sweep flags and env vars referencing the `(app)/` segments**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && {
  echo "## Feature flag keys mentioning legacy segments"
  rg -n "ai|calls|files|projects|settings" app/src/lib/feature-flags/ 2>/dev/null | rg -i "flag|key" || echo "(none)"
  echo
  echo "## Drizzle migrations seeding flags for (app)/-related features"
  rg -n "INSERT INTO feature_flags" app/drizzle/ 2>/dev/null || echo "(none)"
  echo
  echo "## Env vars mentioning the legacy segments"
  rg -n "_AI_|_CALLS_|_FILES_|_PROJECTS_|_SETTINGS_" app/.env.example app/cloudbuild.production.yaml 2>/dev/null || echo "(none)"
} > /tmp/app-routes-flags.txt
cat /tmp/app-routes-flags.txt
```
Expected: most likely empty. The `(app)/` route layer was a structural namespace, not a flag-gated feature, so the expected outcome is "no flag or env var retires with this surface." Document the negative result.

- [ ] **Step 2: Update rubric-evidence.md Section 4**

Replace the `(Filled in Task 3.)` placeholder under `## 4. Feature flag / env var sweep` with the commands, raw output, and classification (likely "No flags or env vars are exclusively read by the retiring surface; no cleanup needed under rubric item 4.").

- [ ] **Step 3: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git add docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md && git -c commit.gpgsign=false commit -m "chore(decom): rubric item 4 — flag/env sweep for (app)/"
```

---

## Task 4: Leaf-safety audit (Rule 2 obligation, also rubric item 3 input)

**Files:**
- Read: `app/src/middleware.ts`, `app/src/lib/i18n.ts` (or `app/src/i18n.ts`), `app/src/components/layout/Sidebar.tsx`, `MobileNav.tsx`, `TopNav.tsx`, `app/src/app/[locale]/layout.tsx`, `app/src/app/sitemap.ts`
- Modify: `docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md`

- [ ] **Step 1: Read shared-plumbing files for `(app)/`-segment references**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && {
  echo "## middleware.ts publicPaths"
  rg -n "publicPaths|/(ai|calls|files|projects|settings)" app/src/middleware.ts || echo "(no matches)"
  echo
  echo "## i18n.ts locale + slug map"
  rg -n "/(ai|calls|files|projects|settings)" app/src/lib/i18n.ts app/src/i18n.ts 2>/dev/null || echo "(no matches)"
  echo
  echo "## Layout/nav components"
  rg -n "/(ai|calls|files|projects|settings)" app/src/components/layout/ 2>/dev/null || echo "(no matches)"
  echo
  echo "## Locale root layout"
  rg -n "/(ai|calls|files|projects|settings)" app/src/app/[locale]/layout.tsx 2>/dev/null || echo "(no matches)"
  echo
  echo "## sitemap.ts"
  rg -n "/(ai|calls|files|projects|settings)" app/src/app/sitemap.ts 2>/dev/null || echo "(no matches)"
} > /tmp/app-routes-leafsafety.txt
cat /tmp/app-routes-leafsafety.txt
```

- [ ] **Step 2: Decision — leaf-safe or shared-plumbing edit needed?**

Read `/tmp/app-routes-leafsafety.txt`:

- **If all sections show `(no matches)`:** the `(app)/` deletion is leaf-safe. Proceed to Task 5 with full subtree deletion.
- **If any shared-plumbing file shows a `(app)/`-segment match that is not also a `(dashboard)/`-segment match:** that file edit is shared plumbing. Decide one of:
  - **Include in this PR** if the edit is small and obvious (e.g., remove a stale `<Link href="/ro/projects">` that should now be `/ro/proiecte`). Document the edit in rubric-evidence.md.
  - **Split out** if the edit is non-trivial (e.g., refactoring middleware logic). Narrow this PR's scope to leaf pages only — delete only the leaf files inside `(app)/` whose deletion does not require the shared-plumbing edit, and create a follow-up issue for the shared-plumbing work.

Document the decision explicitly in rubric-evidence.md Section 3.

- [ ] **Step 3: If shared-plumbing edits are included, make them now**

For each leaf-unsafe finding flagged in Step 2 as "include in this PR":

- Open the file
- Replace the legacy URL with the `(dashboard)/` equivalent OR remove the entry entirely if no longer applicable
- Verify the change with `git diff` before staging

Example (illustrative — only run the version that matches actual findings):

```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git diff app/src/middleware.ts
```

- [ ] **Step 4: Update rubric-evidence.md Section 3 (leaf-safety portion)**

Append to the artifact's Section 3:

````markdown
### Leaf-safety audit (Rule 2)

#### Commands

```bash
rg -n "/(ai|calls|files|projects|settings)" app/src/middleware.ts app/src/lib/i18n.ts app/src/components/layout/ app/src/app/[locale]/layout.tsx app/src/app/sitemap.ts
```

#### Raw output

```
<paste /tmp/app-routes-leafsafety.txt>
```

#### Decision

<one of: "Leaf-safe — full (app)/ subtree deletion proceeds in Task 5" / "Shared-plumbing edits included in this PR (list of files)" / "Scope narrowed to leaf files only — shared-plumbing follow-up issue: <link>">
````

- [ ] **Step 5: Commit (audit + any shared-plumbing edits together)**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git add -A && git -c commit.gpgsign=false commit -m "chore(decom): leaf-safety audit + shared-plumbing edits for (app)/ deletion

Audit captured in rubric-evidence.md Section 3."
```

---

## Task 5: Delete `(app)/` subtree

**Files:**
- Delete: `app/src/app/[locale]/(app)/` (entire subtree, scoped per Task 4 decision)

- [ ] **Step 1: List exactly what will be deleted**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git ls-files "app/src/app/[locale]/(app)/" > /tmp/app-routes-to-delete.txt && cat /tmp/app-routes-to-delete.txt
```
Expected: list of every tracked file under `(app)/`. If Task 4 narrowed scope to leaf files only, edit `/tmp/app-routes-to-delete.txt` to drop files whose deletion was deferred.

- [ ] **Step 2: Delete the files**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git rm $(cat /tmp/app-routes-to-delete.txt | tr '\n' ' ')
```
Expected: each file shows `rm '<path>'` in output. Then verify:
```bash
git status
```
Expected: every listed file shows as `deleted`.

- [ ] **Step 3: Verify the deletion is clean**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && find "app/src/app/[locale]/(app)" -type f 2>/dev/null
```
Expected: empty output (full deletion) or only the deferred leaves (narrowed scope). If unexpected files remain, investigate before committing.

- [ ] **Step 4: Commit the deletion**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git -c commit.gpgsign=false commit -m "feat(decom): delete (app)/ English route layer

Replaced by (dashboard)/ Romanian route layer that landed via the PR #11 → #18 → #19 cascade.

Per plan 2026-04-14-decom-app-route-deletion.md and spec 2026-04-11-legacy-decommissioning-design.md Section 1 Axis 1.

Rubric evidence: docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md"
```

---

## Task 6: Rubric item 3 — Build and route-surface verification

**Files:**
- Modify: `docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md`

- [ ] **Step 1: Run `next build` from the app directory**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes/app && npm run build 2>&1 | tee /tmp/app-routes-build.log
```
Expected: build completes successfully. Capture the full log.

- [ ] **Step 2: If build fails, diagnose and either fix or rollback**

If `npm run build` exits non-zero, inspect `/tmp/app-routes-build.log` for the error. Most likely causes:

- A file outside `(app)/` imported from `(app)/`. Fix the import (probably should target `(dashboard)/` instead).
- A missing route the build expected. Investigate whether the cascade had a soft dependency on `(app)/`.

If the fix is small (one or two edits), make the edit, re-run build, commit when green. If the fix is large or unclear, rollback the deletion (`git revert HEAD`) and re-evaluate the scope decision in Task 4.

- [ ] **Step 3: Run typecheck**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes/app && npm run typecheck 2>&1 | tee /tmp/app-routes-typecheck.log
```
Expected: zero errors.

- [ ] **Step 4: Run unit tests**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes/app && npm run test 2>&1 | tee /tmp/app-routes-test.log
```
Expected: same pass/fail count as on master before the deletion. Pre-existing failures documented in MEMORY.md ("Known Pre-existing Test Failures") are acceptable; new failures must be triaged.

- [ ] **Step 5: Route-surface manual verification**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && {
  echo "## Final scan: any /ro/(ai|calls|files|projects|settings)/ references remaining?"
  rg -n "['\"\`]/(ro|en)/(ai|calls|files|projects|settings)" app/src/ 2>/dev/null || echo "(none — clean)"
} > /tmp/app-routes-final-scan.txt
cat /tmp/app-routes-final-scan.txt
```
Expected: `(none — clean)` or only references documented as acceptable in Task 4 Step 4.

- [ ] **Step 6: Update rubric-evidence.md Section 3 (build + verification portion)**

Append to Section 3:

````markdown
### Build and verification

#### Commands

```bash
cd app && npm run build
cd app && npm run typecheck
cd app && npm run test
rg -n "['\"\`]/(ro|en)/(ai|calls|files|projects|settings)" app/src/
```

#### Results

- `next build`: <PASS / FAIL with notes>
- `tsc --noEmit`: <PASS / FAIL>
- `npm run test`: <pass count> passed, <fail count> failed (vs <baseline> on master)
- Final route-surface scan: <clean / list of accepted residuals>
````

- [ ] **Step 7: Commit (verification artifact + any small fixes)**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git add -A && git -c commit.gpgsign=false commit -m "chore(decom): rubric item 3 — build, typecheck, test verification"
```

---

## Task 7: Rubric items 5, 6, 7 — Test-surface cleanup, migration diff, observability sweep

**Files:**
- Possibly modify: `app/tests/**/*.test.ts` files importing the deleted routes
- Modify: `docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md`

- [ ] **Step 1: Sweep tests for imports of deleted modules**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && rg -ln "@/app/\\[locale\\]/\\(app\\)" app/tests/ 2>/dev/null || echo "(none)"
```
Expected: zero hits. If any test imports the deleted route handlers directly, decide per rubric item 5: delete the test (only testing the retired surface) or migrate (was exercising a keeper via the retired surface).

- [ ] **Step 2: Sweep observability surface**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && {
  echo "## Sentry tag references mentioning legacy segments"
  rg -n "Sentry|sentry" app/src/ 2>/dev/null | rg "ai|calls|files|projects|settings" || echo "(none)"
  echo
  echo "## Custom error classes scoped to legacy segments"
  rg -n "class.*Error" app/src/lib/errors/ 2>/dev/null | rg -i "ai|calls|files|projects|settings" || echo "(none)"
  echo
  echo "## Audit-log event types scoped to legacy segments"
  rg -n "logAudit\(" app/src/ 2>/dev/null | rg -i "/(ai|calls|files|projects|settings)" || echo "(none)"
} > /tmp/app-routes-observability.txt
cat /tmp/app-routes-observability.txt
```
Expected: most likely empty (route layer is structural; observability is per-feature). Document the negative result.

- [ ] **Step 3: Migration diff (rubric item 6)**

Per Task 1, no non-trivial migrations are expected — `(dashboard)/` already exists as the replacement. Document explicitly:

In rubric-evidence.md Section 6, write:

> The replacement `(dashboard)/` route layer pre-exists on master via the cascade landing. No migration of behaviour is performed by this PR; the deletion removes a redundant English-named legacy. Verification rests on rubric items 2 (no callers found) and 3 (build + typecheck + test pass).

If Task 2's reference sweep surfaced any callers that were silently re-pointed during Task 4, list them here as the migration diff.

- [ ] **Step 4: Update rubric-evidence.md Sections 5, 6, 7**

Replace the placeholders for Sections 5, 6, 7 with the commands, raw output, and classifications from Steps 1–3.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git add -A && git -c commit.gpgsign=false commit -m "chore(decom): rubric items 5/6/7 — test, migration, observability sweep for (app)/"
```

---

## Task 8: Open PR with rubric evidence

**Files:** none modified.

- [ ] **Step 1: Verify all seven rubric sections are populated**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && grep -c "(Filled in Task" docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md
```
Expected: `0` (no remaining `(Filled in Task N.)` placeholders).

- [ ] **Step 2: Push branch**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && git push -u origin chore/decom-app-route-deletion
```

- [ ] **Step 3: Open PR**

Run:
```bash
cd /home/godja/Dev/EU-Funds-decom-app-routes && gh pr create --title "feat(decom): delete (app)/ English route layer" --body "$(cat <<'EOF'
## Summary

Deletes the legacy English-named `app/src/app/[locale]/(app)/` route subtree (Axis 1 delete legacy per spec Section 1). Replacement is the Romanian-named `(dashboard)/` route layer that landed with the PR #11 → #18 → #19 cascade on 2026-04-14.

## Rubric evidence

Full evidence for all seven rubric checks (Section 3 of the spec) is at:

\`docs/superpowers/decom-artifacts/2026-04-14-app-route-deletion/rubric-evidence.md\`

Summary:

- **Item 1 — Runtime ownership:** Replacement is `(dashboard)/` route layer.
- **Item 2 — Reference sweep:** <count> matches in app/src, <count> in app/tests, <count> in app/e2e (out of scope), <count> in app/scripts, <count> in docs.
- **Item 3 — Build + route-surface verification:** \`next build\`, \`tsc\`, \`npm test\` all pass; final route-scan clean.
- **Item 4 — Flag/env sweep:** No flags or env vars retire with this surface.
- **Item 5 — Test cleanup:** <none / list of removed/migrated tests>.
- **Item 6 — Migration diff:** No behavioural migration; \`(dashboard)/\` pre-exists.
- **Item 7 — Observability sweep:** No dedicated logs/metrics/Sentry tags scoped to retired segments.

## Test plan

- [ ] CI passes under the gating policy established by `2026-04-11-e2e-gate-rollback-design.md`.
- [ ] Manual smoke: \`/ro/proiecte\`, \`/ro/asistent-ai\`, \`/ro/documente\`, \`/ro/setari\` all load (replacement routes).
- [ ] Manual smoke: \`/ro/projects\`, \`/ro/ai\`, \`/ro/files\`, \`/ro/settings\` 404 (deleted routes).

## Plan reference

`docs/superpowers/plans/2026-04-14-decom-app-route-deletion.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR created.

- [ ] **Step 4: Wait for CI, address any failures, merge**

If CI passes (under the gating policy from the companion spec), merge via the repo's standard process. If CI fails, diagnose per the failed job — most likely a build or test issue surfaced by the deletion that Task 6 missed.

---

## Self-review checklist

- [ ] `(app)/` subtree is gone from master after merge (or only the leaf-safe subset, with a follow-up issue for the rest).
- [ ] `next build`, `tsc`, `npm test` all pass on the merge commit.
- [ ] No file outside `app/src/app/[locale]/(app)/` was modified except the explicitly-documented leaf-safety edits.
- [ ] Rubric evidence file is committed and complete (all seven sections populated, no placeholders).
- [ ] PR description references the rubric evidence file by path.
- [ ] No app/e2e/* file was modified (Rule 1 / spec Out-of-Scope).
