# PR #5 Reference Sweep — `/api/ai/match-grants` + `grant-matcher`

Plan: `docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md` §"PR #5"
Spec: `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` §1, §3

## 1. Route URL sweep — `/api/ai/match-grants`

Grep target: `"/api/ai/match-grants"` across `app/src`, `app/tests`, `app/e2e`.

| Location | Classification | Action |
|---|---|---|
| `app/e2e/full-qa-test.spec.ts:629` | e2e fixture, out of scope per plan | LEAVE |
| `app/tests/integration/match-grants-route.test.ts` | File-scoped to this route | DELETE whole file |
| `app/tests/integration/critical-flows.test.ts` (lines 17–79) | One `it()` block targets this route; other 2 blocks unrelated (authorization boundary via RLS, tenant isolation upload) | Surgical REMOVE of the grant-matching `it()` block |
| `app/tests/integration/security.test.ts:422` | Uses the URL as a fixture inside a middleware-auth test (`should allow authenticated requests to /api/ai/*`). Logic tests middleware behavior — route existence not essential | MIGRATE URL to `/api/ai/chat` (surviving AI route). Same pattern as PR #4's ai-feature-rate-limit URL migration |

No production source imports the URL directly (confirmed via grep).

## 2. Route imports (consumers of what the route pulls in)

```
@/lib/ai/grant-matcher (matchGrants, FundingCall)   ← retires with this PR
@/lib/ai/eu-ai-act (withEUAIActCompliance)          ← KEEPER — sanitize.ts still consumes it
@/lib/validation/schemas (matchGrantsSchema)        ← orphans after route delete → DROP
@/lib/ai/sanitize (sanitizeAIResponseDeep)          ← keeper
@/lib/middleware/auth, @/lib/errors, @/lib/legal/audit,
@/lib/logger, @/lib/db, @/lib/db/schema, drizzle-orm ← keepers
```

## 3. Helper sweep — `grant-matcher.ts` (4-part barrel-aware)

Exports: `matchGrants`, `MatchInput`, `MatchResult`, `FundingCall`

| Axis | Finding |
|---|---|
| Direct `@/lib/ai/grant-matcher` imports | Only the retiring route. 0 after delete. |
| Relative `./grant-matcher` imports inside `lib/ai/` | None |
| Barrel re-export (`lib/ai/index.ts:8`) | `export { matchGrants, type MatchInput, type MatchResult, type FundingCall } from './grant-matcher';` |
| Barrel-keyed consumers (all 4 symbols via `@/lib/ai`) | 0 across repo |
| Transitive imports pulled by grant-matcher | `./client` (keeper), `@/lib/rules/eligibility` (keeper), `zod`. No cascade. |

**Disposition**: delete `grant-matcher.ts` + remove barrel line 8 in same commit.

## 4. Orphan validation schema

After route delete, these have no consumers:
- `matchGrantsSchema` — `app/src/lib/validation/schemas.ts:37`
- `MatchGrantsInput` — `app/src/lib/validation/schemas.ts:80`

DROP both in same commit. Precedent: PR #4.

Note: `companyProfileSchema` (line 28) is referenced only by `matchGrantsSchema`. It becomes transitively unused after this PR, but plan scope lists only `matchGrantsSchema` and `MatchGrantsInput`. Leaving `companyProfileSchema` in place — harmless residue, future sweep candidate.

## 5. `eu-ai-act` re-probe (Plan Task 5.3)

Post-PR consumers of `@/lib/ai/eu-ai-act`:
- `app/src/lib/ai/sanitize.ts` (relative import `./eu-ai-act`) — keeper

Expectation met: `eu-ai-act` retires when `sanitize.ts` is refactored (out of this program's scope).

## 6. CLAUDE.md stale-narrative fixes

- Line 50: `│       ├── ai/             # AI endpoints (match-grants, chat, agent)` → remove `match-grants` token
- Line 106: `Key schemas: extractedCallSchema, matchGrantsSchema, wizardMatchCallsSchema` → remove `matchGrantsSchema`

## 7. Capability absorption

Per spec §3: AI-powered matching of an organization profile against funding calls is absorbed by V3 agent MCP tools:
- `search-calls` (retrieves candidate calls)
- `score-fit` (rank/scoring rule)
- `run-eligibility` (deterministic pre-filter)

`/api/ai/match-grants` is a generation-zero direct RPC that does not integrate with session state, audit chain, or the V3 phase machine. Retiring it removes a parallel matching path while preserving capability in-agent.
