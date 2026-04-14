# Probe 07 — Feature-flag reach

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 7.
**Purpose:** Flags with zero non-test readers are candidates for deletion. Flags read only by a retiring surface retire with the surface (rubric item 4).

## Commands

```bash
rg -n "^\s*key:|^\s*['\"]\w+['\"]:" app/src/lib/feature-flags/
rg -n "isFeatureEnabled\(['\"]([^'\"]+)['\"]" app/src/ -or '$1'
rg -n "INSERT INTO feature_flags|feature_flags.*VALUES" app/drizzle/

flags=$(...)
for flag in $flags; do
  rg -n "['\"]$flag['\"]" app/src/
  rg -n "['\"]$flag['\"]" app/tests/
done
```

## Raw output

```text
## A. Flag keys defined in lib/feature-flags/*
app/src/lib/feature-flags/index.ts:10:  key: string;
app/src/lib/feature-flags/index.ts:48:        key: featureFlags.key,

## B. Flag keys referenced via isFeatureEnabled(...) calls
app/src/app/api/ai/agent/route.ts:107:managed_agent_enabled
app/src/app/api/ai/agent/route.ts:27:agent_v3_enabled
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts:50:section_versioning
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route.ts:52:section_versioning
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route.ts:20:section_versioning
app/src/lib/ai/model-routing.ts:210:gemini-3-preview
app/src/lib/ai/orchestrator/engine.ts:195:section_versioning

## C. Flag rows seeded in drizzle migrations (look for INSERT INTO feature_flags)
app/drizzle/0022_managed_agent_enabled_flag.sql:3:INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
app/drizzle/0015_agent_v3_feature_flag.sql:3:INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)

# Per-flag reader counts

## Flag: agent_v3_enabled
### Readers in app/src (excluding tests)
app/src/app/api/ai/agent/route.ts:27:  const enabled = await isFeatureEnabled('agent_v3_enabled', { userId: user.id })
### Readers in app/tests
app/tests/integration/managed/route-pre-stream-fallback.test.ts:10:    if (key === 'agent_v3_enabled') return true
app/tests/integration/managed/route-flag-off.test.ts:9:    if (key === 'agent_v3_enabled') return true
app/tests/integration/managed/route-action-bypass.test.ts:11:    if (key === 'agent_v3_enabled') return true
app/tests/integration/managed/route-mid-stream-failure.test.ts:18:    if (key === 'agent_v3_enabled') return true
app/tests/integration/managed/route-breaker-open.test.ts:9:    if (key === 'agent_v3_enabled') return true

## Flag: gemini-3-preview
### Readers in app/src (excluding tests)
app/src/lib/ai/model-routing.ts:210:  const geminiPreview = await isFeatureEnabled('gemini-3-preview', { userId })
### Readers in app/tests
(none)

## Flag: managed_agent_enabled
### Readers in app/src (excluding tests)
app/src/app/api/ai/agent/route.ts:107:    (await isFeatureEnabled('managed_agent_enabled', { userId: user.id }))
### Readers in app/tests
app/tests/integration/managed/route-flag-off.test.ts:10:    if (key === 'managed_agent_enabled') return false
app/tests/integration/managed/route-pre-stream-fallback.test.ts:11:    if (key === 'managed_agent_enabled') return true
app/tests/integration/managed/route-mid-stream-failure.test.ts:19:    if (key === 'managed_agent_enabled') return true
app/tests/integration/managed/route-breaker-open.test.ts:10:    if (key === 'managed_agent_enabled') return true
app/tests/integration/managed/route-action-bypass.test.ts:12:    if (key === 'managed_agent_enabled') return true

## Flag: section_versioning
### Readers in app/src (excluding tests)
app/src/lib/ai/orchestrator/engine.ts:195:      const versioningEnabled = await isFeatureEnabled('section_versioning', {
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route.ts:20:    const enabled = await isFeatureEnabled('section_versioning', { userId: user.id });
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts:50:    const enabled = await isFeatureEnabled('section_versioning', { userId: user.id });
app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route.ts:52:    const enabled = await isFeatureEnabled('section_versioning', { userId: user.id });
### Readers in app/tests
(none)
```

## Classification

| Flag key | Non-test readers | Test readers | Classification |
|----------|------------------|--------------|----------------|
| `agent_v3_enabled` | 1 | 5 | Keeper (gates V3 bridge; retires with V3 runtime, not this program) |
| `managed_agent_enabled` | 1 | 5 | Keeper (gates Managed target runtime) |
| `section_versioning` | 4 | 0 | Retire-with-surface candidate for the orchestrator track |
| `gemini-3-preview` | 1 | 0 | Keeper (model-routing flag outside the active decommission tracks) |

## Notes

- The key enumeration is heuristic, but it surfaced every flag actually used by `isFeatureEnabled(...)` on current `master`.
- The only flag cleanly tied to a retiring legacy surface is `section_versioning`.
