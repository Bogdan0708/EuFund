# Reference Sweep — PR #2 `/api/ai/check-eligibility`

Date: 2026-04-14
Scope: `app/src app/tests app/e2e app/scripts docs`

## Search term

`check-eligibility` (route URL) across all scoped trees.

## Findings

| Path | Classification |
|---|---|
| `app/src/app/api/ai/check-eligibility/route.ts` | Retire (delete). The route being retired. |
| `app/tests/integration/check-eligibility-route.test.ts` | Delete. Sole-purpose integration test that mocks `@/lib/auth`, `@/lib/legal/audit`, `@/lib/monitoring/metrics`, `@/lib/logger` and hits the route's POST handler directly. No shared fixtures. |
| `app/e2e/ai-assistant.spec.ts` | Out of program scope (`app/e2e/*` is not modified by this plan). Contains 1 test referencing the route. Accepted fallout: the test will 404 post-deletion. e2e is non-blocking per the April 2026 e2e-gate rollback. |
| `app/agent-harness/fondeu/commands/ai.py`, `test.py` | Out of scope — developer CLI, not product code. |
| `docs/**` (plan, spec, probe outputs, CLAUDE.md narrative) | Documentation references — no modification required. |

## Route imports (pre-delete verification)

From `app/src/app/api/ai/check-eligibility/route.ts`:

- `@/lib/auth`
- `@/lib/errors`
- `@/lib/validation/schemas` (`checkEligibilitySchema`)
- `@/lib/rules/eligibility` (`runEligibilityRules`)
- `@/lib/legal/audit`
- `@/lib/monitoring/metrics`
- `@/lib/logger`

**None of these are `@/lib/ai/*` root helpers.** Zero helper-orphan cascade expected.

## Post-delete `lib/ai/*` helper probe

Command:

```
rg -n "from ['\"]@/lib/ai/" app/src/app/api/ai 2>/dev/null || echo "(none)"
```

Result (after the delete in the same commit):

```
(none from within the deleted route tree; remaining matches under app/src/app/api/ai belong to other still-live routes — see commit diff)
```

Specifically, no `@/lib/ai/*` import originating from files this PR deletes survives into orphanhood — because the deleted route imported none.

## Observability surface

`logAudit` `action: 'ai.compliance_check'` with `resourceType: 'eligibility_check'` was emitted ONLY by this route. Grep confirms no other emitter uses that `resourceType`:

```
rg -n "eligibility_check" app/src
# -> app/src/app/api/ai/check-eligibility/route.ts:42:      resourceType: 'eligibility_check',
```

Observability surface retires cleanly with the route.

## Runtime ownership after retirement

Deterministic eligibility pre-filter capability is absorbed by the V3 agent's
`run-eligibility` MCP rules tool at
`app/src/lib/ai/agent/mcp/rules/run-eligibility.ts`. See
`docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` §3.
