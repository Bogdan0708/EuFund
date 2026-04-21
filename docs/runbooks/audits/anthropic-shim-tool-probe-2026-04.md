# Anthropic OpenAI-Compat Shim Probe — 2026-04

**Purpose:** Before Task 14 consolidates `RouterMessage.tool_calls` on the shim path, document the shim's pre-fix behavior when the router hands it a tool turn.

## Probe
`app/tests/unit/ai/providers/anthropic-shim-tool-probe.test.ts`

## Observation
`PROBE_OBSERVATION {"assistantHasToolCalls":false,"toolRoleMessagePresent":true}`

- `assistantHasToolCalls`: false
- `toolRoleMessagePresent`: true

## Interpretation
- `assistantHasToolCalls` is false and a `tool`-role message is present → the shim was silently dropping the assistant tool-call history. Any live tool turn routed through Anthropic would have been malformed and would have failed against the real API. Task 14 fixes this for both cached and non-cached paths.

The root cause is visible in `app/src/lib/ai/providers/anthropic.ts` (pre-fix): the non-tool-role branch of the message mapper reduces each `RouterMessage` to `{ role, content }`, dropping any `tool_calls` the router pushes on an assistant turn. The `tool`-role branch is preserved, so the `tool_call_id` reference survives — but the assistant message it refers to is stripped of its `tool_calls`, producing a malformed conversation shape.

## Conclusion
Task 14 makes both cache and non-cache paths emit `tool_calls` on assistant messages. No existing production path is knowingly exercising the broken shape (per Task 5 audit, V3 did not push `tool_calls` through the router before Task 21, and V3 is the primary tool-using caller). This fix is latent-bug-closing rather than customer-regressing — no production escalation needed.
