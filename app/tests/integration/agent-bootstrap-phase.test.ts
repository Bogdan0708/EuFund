import { describe, it } from 'vitest'

/**
 * Deferred integration test — placeholder for Phase 2.
 *
 * **Intent:** assert that when the managed runtime handles its first turn on
 * a session seeded with `phase: 'structuring'` + `selectedCallId` + populated
 * `blueprint`, it does NOT call `search_calls` on that first turn. That
 * invariant is the behavioral payoff of deterministic preselect: the agent
 * should pick up the already-selected call and move straight to outline /
 * structuring work instead of re-running discovery.
 *
 * **Why it's skipped in Phase 1:**
 * `runManagedTurn(opts)` takes a heavyweight options bag (session, sections,
 * request, emit, serviceCtx, turnId) plus a live Anthropic client obtained
 * from `getAnthropicClient()`. Stubbing the SDK and assembling a valid
 * AgentRequest / AgentEvent stream is disproportionate infra for a guarantee
 * that is already covered at the prompt layer.
 *
 * **What already guards this invariant today:**
 * `tests/unit/managed/prompt-phase-bootstrap.test.ts` (Task 6) — 10 tests
 * proving that `buildManagedSystemPrompt` emits the bootstrap block
 * ("Nu re-căuta apeluri" / "Do not re-run call search.") for structuring +
 * research phases with a selectedCallId, and suppresses it for discovery or
 * when selectedCallId is null. Those tests pin the prompt contract the
 * model sees, which is the proximate cause of the agent's tool choice.
 *
 * **What this integration test should eventually assert:**
 * - Seed a session with `phase: 'structuring'`, `selectedCallId: 'CALL-A'`,
 *   `blueprint: <any structured blueprint>`, `outlineFrozen: false`.
 * - Invoke `runManagedTurn` with a first user message (project description).
 * - Collect emitted events; extract tool_use block names.
 * - Assert the tool-use list does NOT contain `search_calls`.
 *
 * Un-skip once the managed runtime has a lighter test harness (current
 * attempts require stubbing Anthropic SDK + streaming + event emitter, which
 * is Phase 2 work).
 */
describe.skip('agent bootstrap phase — first turn on preselected session', () => {
  it('does not call search_calls on the first turn when phase=structuring and selectedCallId is set', () => {
    // Implementation deferred — see docblock above.
  })
})
