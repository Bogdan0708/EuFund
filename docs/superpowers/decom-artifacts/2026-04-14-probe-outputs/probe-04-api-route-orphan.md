# Probe 04 — API-route orphan probe

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 4.
**Purpose:** Classify each `/api/ai/*` and `/api/v1/*` route by frontend reference count and test reference count. Zero frontend + zero non-route-test references → orphan candidate.

## Commands

```bash
find app/src/app/api/ai -name "route.ts" -type f | sort
find app/src/app/api/v1 -name "route.ts" -type f | sort

while IFS= read -r route_file; do
  url=$(echo "$route_file" | sed -e 's|app/src/app||' -e 's|/route.ts||')
  static_url=$(printf '%s' "$url" | sed 's|/\[[^/]*\]||g')
  rg -n "\"$static_url\"|'$static_url'|\`$static_url\`" app/src/app app/src/components app/src/hooks
  rg -n "\"$static_url\"|'$static_url'|\`$static_url\`" app/tests app/e2e
done
```

## Per-route results

```text
# Per-route reference counts

## Route: /api/ai/agent (app/src/app/api/ai/agent/route.ts)
### Static-match URL used for grep: /api/ai/agent
### Frontend references (app, components, hooks)
app/src/hooks/useAgent.ts:186:      const response = await csrfFetch('/api/ai/agent', {
### Test references
(none)

## Route: /api/ai/agent/sessions/[sessionId]/messages (app/src/app/api/ai/agent/sessions/[sessionId]/messages/route.ts)
### Static-match URL used for grep: /api/ai/agent/sessions/messages
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions (app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions/route.ts)
### Static-match URL used for grep: /api/ai/agent/sessions/sections/versions
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/agent/sessions/[sessionId]/sections (app/src/app/api/ai/agent/sessions/[sessionId]/sections/route.ts)
### Static-match URL used for grep: /api/ai/agent/sessions/sections
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/agent/sessions (app/src/app/api/ai/agent/sessions/route.ts)
### Static-match URL used for grep: /api/ai/agent/sessions
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/agent/state (app/src/app/api/ai/agent/state/route.ts)
### Static-match URL used for grep: /api/ai/agent/state
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/chat (app/src/app/api/ai/chat/route.ts)
### Static-match URL used for grep: /api/ai/chat
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/check-eligibility (app/src/app/api/ai/check-eligibility/route.ts)
### Static-match URL used for grep: /api/ai/check-eligibility
### Frontend references (app, components, hooks)
app/src/app/api/ai/check-eligibility/route.ts:59:    trackRequest(req.method, '/api/ai/check-eligibility', 200, Date.now() - start);
app/src/app/api/ai/check-eligibility/route.ts:63:    trackRequest(req.method, '/api/ai/check-eligibility', status, Date.now() - start);
### Test references
app/e2e/ai-assistant.spec.ts:36:    const response = await page.request.post('/api/ai/check-eligibility', {

## Route: /api/ai/diagnostic (app/src/app/api/ai/diagnostic/route.ts)
### Static-match URL used for grep: /api/ai/diagnostic
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/generate-insights (app/src/app/api/ai/generate-insights/route.ts)
### Static-match URL used for grep: /api/ai/generate-insights
### Frontend references (app, components, hooks)
(none)
### Test references
app/tests/integration/critical-flows.test.ts:102:    const req = createJsonRequest('/api/ai/generate-insights', {

## Route: /api/ai/generate-proposal-enhanced (app/src/app/api/ai/generate-proposal-enhanced/route.ts)
### Static-match URL used for grep: /api/ai/generate-proposal-enhanced
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/generate-proposal (app/src/app/api/ai/generate-proposal/route.ts)
### Static-match URL used for grep: /api/ai/generate-proposal
### Frontend references (app, components, hooks)
(none)
### Test references
app/e2e/full-qa-test.spec.ts:621:    const badProposal = await page.request.post('/api/ai/generate-proposal', {
app/tests/integration/tier-gating.test.ts:23:    const response = await POST(createJsonRequest('/api/ai/generate-proposal', {
app/tests/integration/tier-gating.test.ts:53:    const response = await POST(createJsonRequest('/api/ai/generate-proposal', {
app/tests/integration/security.test.ts:459:        const request = createNextRequest('/api/ai/generate-proposal', {
app/tests/integration/security.test.ts:494:      const request = createNextRequest('/api/ai/generate-proposal', {
app/tests/integration/critical-flows.test.ts:130:    const invalidRes = await POST(createJsonRequest('/api/ai/generate-proposal', { fundingProgram: 'pnrr' }));
app/tests/integration/critical-flows.test.ts:133:    const validRes = await POST(createJsonRequest('/api/ai/generate-proposal', {

## Route: /api/ai/generate-report (app/src/app/api/ai/generate-report/route.ts)
### Static-match URL used for grep: /api/ai/generate-report
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/ghid-to-tasks (app/src/app/api/ai/ghid-to-tasks/route.ts)
### Static-match URL used for grep: /api/ai/ghid-to-tasks
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/match-grants (app/src/app/api/ai/match-grants/route.ts)
### Static-match URL used for grep: /api/ai/match-grants
### Frontend references (app, components, hooks)
(none)
### Test references
app/e2e/full-qa-test.spec.ts:629:      page.request.post('/api/ai/match-grants', {
app/tests/integration/security.test.ts:422:      const request = createNextRequest('/api/ai/match-grants', {
app/tests/integration/critical-flows.test.ts:62:    const req = createJsonRequest('/api/ai/match-grants', {

## Route: /api/ai/orchestrator/message (app/src/app/api/ai/orchestrator/message/route.ts)
### Static-match URL used for grep: /api/ai/orchestrator/message
### Frontend references (app, components, hooks)
app/src/hooks/useOrchestrator.ts:422:        const res = await csrfFetch('/api/ai/orchestrator/message', {
### Test references
app/e2e/full-qa-test.spec.ts:614:    const noMsg = await page.request.post('/api/ai/orchestrator/message', {

## Route: /api/ai/orchestrator/messages (app/src/app/api/ai/orchestrator/messages/route.ts)
### Static-match URL used for grep: /api/ai/orchestrator/messages
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback (app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts)
### Static-match URL used for grep: /api/ai/orchestrator/sessions/sections/rollback
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state (app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route.ts)
### Static-match URL used for grep: /api/ai/orchestrator/sessions/sections/state
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions (app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route.ts)
### Static-match URL used for grep: /api/ai/orchestrator/sessions/sections/versions
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/orchestrator/sessions (app/src/app/api/ai/orchestrator/sessions/route.ts)
### Static-match URL used for grep: /api/ai/orchestrator/sessions
### Frontend references (app, components, hooks)
(none)
### Test references
app/e2e/full-qa-test.spec.ts:402:    const sessionsRes = await page.request.get('/api/ai/orchestrator/sessions').catch(() => null);
app/e2e/ai-assistant.spec.ts:22:    const response = await page.request.get('/api/ai/orchestrator/sessions');
app/e2e/api-admin.spec.ts:116:    const res = await page.request.get('/api/ai/orchestrator/sessions');

## Route: /api/ai/orchestrator/stream (app/src/app/api/ai/orchestrator/stream/route.ts)
### Static-match URL used for grep: /api/ai/orchestrator/stream
### Frontend references (app, components, hooks)
(none)
### Test references
(none)

## Route: /api/ai/search-calls (app/src/app/api/ai/search-calls/route.ts)
### Static-match URL used for grep: /api/ai/search-calls
### Frontend references (app, components, hooks)
(none)
### Test references
(none)
```

## Classification

| Route | Frontend refs | Test refs | Classification |
|-------|--------------|-----------|----------------|
| `/api/ai/agent` | 1 | 0 | Keeper (target runtime) |
| `/api/ai/agent/sessions/[sessionId]/messages` | 0 | 0 | Keeper-by-family; static-prefix grep undercounts parameterized agent routes |
| `/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions` | 0 | 0 | Keeper-by-family; static-prefix grep undercounts parameterized agent routes |
| `/api/ai/agent/sessions/[sessionId]/sections` | 0 | 0 | Keeper-by-family; static-prefix grep undercounts parameterized agent routes |
| `/api/ai/agent/sessions` | 0 | 0 | Keeper-by-family; static-prefix grep undercounts runtime callers |
| `/api/ai/agent/state` | 0 | 0 | Keeper-by-family; target runtime support route |
| `/api/ai/chat` | 0 | 0 | Out of current decommission tracks; not classified as a delete candidate by this program |
| `/api/ai/check-eligibility` | 2 | 1 | Legacy route candidate; frontend hits are route-internal instrumentation only, so effective external frontend reach is 0 |
| `/api/ai/diagnostic` | 0 | 0 | Independent sweep (Plan 5) |
| `/api/ai/generate-insights` | 0 | 1 | Legacy route candidate; test-backed only |
| `/api/ai/generate-proposal-enhanced` | 0 | 0 | Orphan candidate |
| `/api/ai/generate-proposal` | 0 | 7 | Legacy route candidate; test-backed only |
| `/api/ai/generate-report` | 0 | 0 | Orphan candidate |
| `/api/ai/ghid-to-tasks` | 0 | 0 | Orphan candidate |
| `/api/ai/match-grants` | 0 | 3 | Legacy route candidate; test-backed only |
| `/api/ai/orchestrator/message` | 1 | 1 | Migration candidate tied to `useOrchestrator` |
| `/api/ai/orchestrator/messages` | 0 | 0 | Delete candidate once orchestrator track lands |
| `/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback` | 0 | 0 | Delete candidate once orchestrator track lands |
| `/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state` | 0 | 0 | Delete candidate once orchestrator track lands |
| `/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions` | 0 | 0 | Delete candidate once orchestrator track lands |
| `/api/ai/orchestrator/sessions` | 0 | 3 | Test-backed delete candidate in orchestrator track |
| `/api/ai/orchestrator/stream` | 0 | 0 | Delete candidate once orchestrator track lands |
| `/api/ai/search-calls` | 0 | 0 | Orphan candidate |

## Notes

- `/api/v1/*` routes were enumerated in `/tmp/probe-04-routes.txt` and intentionally left informational here; the active legacy program tracks center on `/api/ai/*`.
- Parameterized agent routes are undercounted by static-prefix matching and should not be misread as unused.
- The check-eligibility frontend hits came from the route file's own `trackRequest(...)` instrumentation, not from a caller.
