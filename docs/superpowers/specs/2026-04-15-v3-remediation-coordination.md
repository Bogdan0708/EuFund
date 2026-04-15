# V3 Security Remediation — Two-Session Coordination

**Date:** 2026-04-15
**Branch:** `fix/agent-v3-mutation-guards`
**Status:** Active

## Purpose

Coordinate two parallel Claude sessions working the remaining V3 security fixes. Written after a prior session mismarked three findings as "addressed" by conflating plan-file targets with landed code. This doc is the shared source of truth; plan docs are not.

## Role split

- **Implementer session** — drives `fix/agent-v3-mutation-guards`, lands one item per commit.
- **Reviewer session** — read-only. After each commit, audits the actual diff and files against the matrix below. Never cites plan docs as evidence of a landed fix.

Do not run two writing sessions on the same branch/worktree.

## Corrected findings matrix (source of truth)

| # | Item | Status | Evidence anchor |
|---|---|---|---|
| 1 | `agent_sessions` migration drift | Open — planned only | `app/src/lib/db/schema.ts` vs `app/drizzle/*` |
| 2 | AI rate-limit bypass | Open | `app/src/lib/middleware/auth.ts:121-122` (commit `40507cb`) |
| 3 | `seed-admin.ts` hardcoded password | Open | `app/scripts/seed-admin.ts:15` (`DEV_PASSWORD = 'DevAdmin123!'`) |
| 4 | `ci.yml` hardcoded password literals (x4) | Open | `.github/workflows/ci.yml:151,196,201,211` (`fondeu_dev_2026`) |
| 5 | CSRF `!isPublic` bypass | Addressed ✅ | `app/src/middleware.ts:237` (commit `f7f702b`) |

## Execution order

1. Item 1 — migration drift (additive, lowest risk, unblocks ORM reads).
2. Item 2 — AI rate limiting (fail-closed Redis gate, tier resolution, 24h window + per-feature caps, test passes).
3. Items 3 + 4 — **must land together.** Removing the hardcoded password from `seed-admin.ts` breaks CI's seed step unless `CI_ADMIN_PASSWORD` and `CI_POSTGRES_PASSWORD` secrets exist first.

## Prerequisites before items 3+4

- Create `CI_POSTGRES_PASSWORD` and `CI_ADMIN_PASSWORD` in repo Settings → Secrets and variables → Actions.
- Confirm `REDIS_URL` is set in local `.env.local` before item 2 merges (otherwise dev AI calls will 503).

## Guardrails

- **Plan/spec docs are not evidence of landed code.** Reviewer verifies against files and diff only.
- **Items 3 and 4 are coupled** — do not land one without the other.
- **Matrix above is source of truth** — update it only when a commit actually lands the fix.
- **Reviewer failure modes to watch for:** trusting an implementer summary, reading an older cached file, citing the plan file's target state.

## Reviewer checklist (per commit)

1. `git show <sha> --stat` — confirm files touched match the item's evidence anchor.
2. Read the changed lines directly, not the commit message's description of them.
3. Run `npm run typecheck` and the relevant test file.
4. For item 2 specifically: grep for `Rate limiting disabled` and confirm the string is gone; confirm `isRedisAvailable()` and `checkRateLimit()` calls are present in `guardAIRequest`.
5. For items 3+4: confirm both literals removed in the same commit/branch; confirm secrets referenced in `ci.yml` match the secrets created in repo settings.
6. Update the matrix row status only after all checks pass.

## Done criteria

All four open rows flip to "Addressed ✅" with a commit SHA. CI green on the branch. Then PR into master.
