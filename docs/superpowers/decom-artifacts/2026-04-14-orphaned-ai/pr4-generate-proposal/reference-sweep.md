# PR #4 Reference Sweep — `/api/ai/generate-proposal` + `proposal-generator` + `fact-checker`

Date: 2026-04-14
Branch: `chore/decom-orphan-generate-proposal`
Base: `origin/master` f0d3937

## 1. Route URL sweep (`/api/ai/generate-proposal`)

| File | Lines | Classification | Action |
|------|-------|----------------|--------|
| `app/e2e/full-qa-test.spec.ts:621` | e2e spec | OUT OF SCOPE | Do not touch |
| `app/tests/integration/tier-gating.test.ts` | 13–33, 35–61 | Surgical | Remove 2 of 3 `it()` blocks |
| `app/tests/integration/ai-feature-rate-limit.test.ts` | 3 blocks | Migrate | Swap fixture URL to `/api/ai/chat` |
| `app/tests/integration/critical-flows.test.ts` | 80–106 | Surgical | Remove 1 of 4 `it()` blocks |
| `app/tests/integration/security.test.ts` | 437–469, 471–504, 547–557 | Surgical | Remove 3 `it()` blocks |
| `app/src/app/api/ai/generate-proposal/route.ts` | full | Retire | `git rm` |

Docs/plan references in `docs/superpowers/**` are retained as historical record (plan + spec + artifacts).

## 2. Helper barrel-aware sweeps

### `proposal-generator.ts`
- **Direct-path consumers**: only `route.ts` of the retiring route.
- **Relative consumers inside `lib/ai/`**: zero.
- **Barrel re-export** (`app/src/lib/ai/index.ts:7`): `generateProposal`, `proposalInputSchema`, `ProposalInput`, `ProposalOutput`.
- **Barrel consumers** for all 4 symbols: zero across `app/src`, `app/tests`, `app/scripts`.
- **Disposition**: DELETE helper + REMOVE barrel line 7 in this PR.

### `fact-checker.ts`
- **Direct-path consumers**: only `route.ts` of the retiring route.
- **Relative consumers inside `lib/ai/`**: zero.
- **Barrel re-export**: none (not in `index.ts`).
- **Disposition**: clean DELETE.

### Transitive imports (cascade check for `proposal-generator`)
`./client`, `@/lib/rag/pipeline`, `@/lib/utils/romanian`, `./sanitize`, `@/lib/logger`.
All are KEEPERS with multiple other consumers. **No cascade.**

## 3. Orphan schema cleanup

After route deletion + `security.test.ts` surgical removal:
- `generateProposalSchema` (`app/src/lib/validation/schemas.ts:28`) — orphan, DELETED.
- `GenerateProposalInput` type (`app/src/lib/validation/schemas.ts:97`) — orphan, DELETED.
- Pre-deletion consumer grep: route + security.test.ts only (both retired above). Post-deletion grep: zero.

## 4. Test classification decisions

### `tier-gating.test.ts` — surgical removal (3 → 1 `it()` blocks)
- Removed: "rejects proposal generation for free-tier users" (generate-proposal).
- Removed: "allows proposal generation for pro-tier users" (generate-proposal).
- Kept: "rejects MySMIS export for free-tier users" (unrelated, covers mysmis-export route).

### `critical-flows.test.ts` — surgical removal (4 → 3 `it()` blocks)
- Removed: "application generation rejects invalid payloads and accepts valid ones" (generate-proposal).
- Kept: grant matching, RLS document access boundary, tenant-isolation upload.

### `security.test.ts` — surgical removal of 3 `it()` blocks within `describe('Input Validation')`
- Removed: "should reject /api/ai/generate-proposal with missing fields".
- Removed: "should accept valid payload for /api/ai/generate-proposal".
- Removed: "should validate schema for /api/ai/generate-proposal" (imported `generateProposalSchema`).
- Kept: all other CSRF/Security Headers/Auth Middleware blocks + remaining Input Validation blocks (predict-success + TRL).

### `ai-feature-rate-limit.test.ts` — MIGRATE (URL fixture swap)
**Verdict**: Migrate, don't delete.

**Rationale**:
1. The file tests `withAIAuth` middleware directly (not via the retired route). `/api/ai/generate-proposal` is used only as a cosmetic `NextRequest` URL; no route module is imported.
2. No standalone unit test for `withAIAuth` exists — `rg -l "withAIAuth" app/tests/unit/` returned zero matches.
3. Middleware coverage is preserved by swapping the fixture URL to a surviving AI route (`/api/ai/chat`). `/api/ai/match-grants` is also retiring in PR #5, so `/api/ai/chat` was chosen.
4. `feature: 'proposal'` is retained — it's a middleware feature-key constant (`AIFeature` type in `@/lib/middleware/auth`), not coupled to the deleted route. The key still exists on the middleware type. Tests validate feature-keyed rate limits generically.

**Change**: single `sed` replacing 3 occurrences of `/api/ai/generate-proposal` → `/api/ai/chat` in the NextRequest URLs. No other edits.

## 5. Post-PR #4 eu-knowledge-base projection

- `eu-knowledge-base.ts` previously had 2 direct-path consumers: `proposal-generator.ts` (deleted here) and `fact-checker.ts` (deleted here).
- **Post-PR #4 direct-path consumers**: zero.
- **Barrel re-export** (`app/src/lib/ai/index.ts:16`): retained — not in scope for this PR per plan.
- **Disposition**: DEFERRED to final cleanup PR (per plan).

## 6. Verification (pre-commit)

```
rg -n "proposal-generator|fact-checker" app/src/lib/ai/index.ts   # zero
rg -n "/api/ai/generate-proposal" app/src app/tests               # zero
rg -n "generateProposalSchema|GenerateProposalInput" app/src app/tests app/scripts  # zero
rg -n "proposal-generator|fact-checker" app/src app/tests         # zero
```

All grep checks passed.
